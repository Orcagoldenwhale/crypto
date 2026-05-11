/**
 * Детектор Order Blocks на основе уже посчитанных StructureBreak'ов.
 *
 * Идея (классическая ICT):
 *   1. Дано событие BOS/CHoCH с известной break-свечой.
 *   2. Идём ПО СВЕЧАМ от break-свечи назад до той, что породила сломанный
 *      swing-уровень. Ищем последнюю «противонаправленную» свечу:
 *        - для break↑ — последний bearish bar (close < open);
 *        - для break↓ — последний bullish bar (close > open).
 *   3. Эта свеча и есть OB. Зона = [low, high] свечи.
 *   4. hasFvg — есть ли в диапазоне (OB.index .. breakIdx) хотя бы один
 *      3-свечный FVG того же направления, что и импульс.
 *   5. Mitigation: первая свеча ПОСЛЕ break, которая зашла внутрь OB
 *      (low ≤ maxPrice для bull; high ≥ minPrice для bear).
 *
 * Важно: дубликаты OB по координатам (одна и та же свеча может попасть в
 * несколько break-событий, если структура рисует несколько BOS'ов подряд)
 * мы фильтруем по уникальному `startTime` + направлению.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { LiquidityZone, ObExtractionMode, OrderBlockZone, StructureBreak } from './types';

interface OhlcCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DetectOrderBlocksOptions {
  /**
   * Если true — оставляем только OB, у которых есть FVG между блоком и
   * break-свечой.
   */
  requireFvg?: boolean;
  /** Как выделять границы OB (wicks/body/auto). По умолчанию 'wicks'. */
  extraction?: ObExtractionMode;
  /**
   * Учитывать ли Mean Threshold при mitigation. Если true — зона
   * считается отработанной только при закрытии свечи телом за MT.
   */
  useMeanThreshold?: boolean;
  /**
   * Требовать "поглощение": последующая свеча должна закрыться телом
   * за пределами тела OB (ниже close для bear, выше для bull).
   */
  requireAbsorption?: boolean;
  /**
   * Если true — расширять OB на цепочку из N однонаправленных свеч
   * (STB/BTS из лекции про top-down analysis). Границы зоны = объединение
   * всех свеч в цепочке. По умолчанию false — берём одну свечу.
   */
  allowMultiCandle?: boolean;
  /** Максимальная длина multi-candle OB. По умолчанию 3. */
  multiCandleMax?: number;
  // ============== Контекстные фильтры (лекция OB §3) ==============
  /**
   * Только OB на снятии ликвидности: OB-свеча должна пробивать
   * swing-уровень (для bull OB — пробить SSL low, для bear — BSL high).
   */
  requireSweep?: boolean;
  /** Только OB на тесте предыдущего OB (фрактальная вложенность). */
  requirePrevBlock?: boolean;
  /** Список ликвидных зон (нужен для requireSweep). */
  liquidityZones?: readonly LiquidityZone[];
}

export function detectOrderBlocks(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  breaks: readonly StructureBreak[],
  options: DetectOrderBlocksOptions = {},
): OrderBlockZone[] {
  if (candles.length === 0 || breaks.length === 0) return [];
  const arr = candles as readonly OhlcCandle[];
  const lastTime = arr[arr.length - 1]!.timestamp;

  const out: OrderBlockZone[] = [];
  // Хранит все OB-кандидаты (даже отброшенные фильтром requirePrevBlock),
  // чтобы фильтр работал по полному списку предыдущих блоков, а не только
  // по уже прошедшим. Иначе первый OB без предка отбрасывает всю цепочку.
  const allCandidates: { obTime: number; minPrice: number; maxPrice: number }[] = [];
  // Дедуп по «отправной» свече и направлению — чтобы серия BOS'ов не
  // плодила копии одного и того же OB.
  const seen = new Set<string>();

  for (const sb of breaks) {
    const breakIdx = findIndexByTime(arr, sb.breakTime);
    const levelIdx = findIndexByTime(arr, sb.levelTime);
    if (breakIdx < 0 || levelIdx < 0) continue;
    if (breakIdx <= levelIdx) continue;

    // Ищем последний противонаправленный бар в диапазоне (levelIdx .. breakIdx-1].
    // Идём СПРАВА налево — нам нужен ближайший к break-свече.
    const obIdx = findLastOppositeBar(arr, levelIdx + 1, breakIdx - 1, sb.dir);
    if (obIdx < 0) continue;

    const ob = arr[obIdx]!;
    const dedupKey = `${sb.dir}-${ob.timestamp}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const hasFvg = checkFvgInRange(arr, obIdx, breakIdx, sb.dir);
    if (options.requireFvg && !hasFvg) continue;

    const kind: OrderBlockZone['kind'] = sb.dir === 'up' ? 'bull' : 'bear';
    const extraction = options.extraction ?? 'wicks';

    // ===== Контекстные фильтры из лекции OB §3 =====
    // Применяются по схеме AND: если несколько включены — должны выполниться все.
    if (options.requireSweep) {
      if (!candleSweepsLiquidity(ob, kind, options.liquidityZones ?? [])) continue;
    }
    if (options.requirePrevBlock) {
      // Используем allCandidates (а не out) — иначе фильтр инвалидировал бы
      // самый ранний OB и обрывал бы всю цепочку.
      if (!candleInsidePrevOb(ob, allCandidates)) {
        // Всё равно регистрируем как кандидата для последующих проверок.
        allCandidates.push({ obTime: ob.timestamp, minPrice: ob.low, maxPrice: ob.high });
        continue;
      }
    }
    allCandidates.push({ obTime: ob.timestamp, minPrice: ob.low, maxPrice: ob.high });

    // Multi-candle OB: расширяем цепочкой однонаправленных свеч назад от obIdx,
    // пока они той же полярности и не дальше multiCandleMax от obIdx.
    let groupFromIdx = obIdx;
    if (options.allowMultiCandle) {
      const maxLen = options.multiCandleMax ?? 3;
      while (
        groupFromIdx > levelIdx + 1 &&
        obIdx - groupFromIdx + 1 < maxLen
      ) {
        const prev = arr[groupFromIdx - 1]!;
        // Та же полярность: для bull OB (sb.dir='up') — bearish свеча,
        // для bear OB — bullish свеча.
        const samePolarity = sb.dir === 'up'
          ? prev.close < prev.open
          : prev.close > prev.open;
        if (!samePolarity) break;
        groupFromIdx--;
      }
    }
    const bounds = groupFromIdx === obIdx
      ? extractObBounds(ob, extraction)
      : extractGroupBounds(arr, groupFromIdx, obIdx, extraction);
    const minPrice = bounds.minPrice;
    const maxPrice = bounds.maxPrice;

    // Поглощение: следующая после break свеча должна закрыться телом
    // за пределами тела OB-свечи.
    if (options.requireAbsorption) {
      const absorbed = checkAbsorption(arr, obIdx, breakIdx, kind);
      if (!absorbed) continue;
    }

    // MT для multi-candle: между body-low и body-high всей группы.
    const mtPrice = groupFromIdx === obIdx
      ? (ob.open + ob.close) / 2
      : (() => {
          let bodyTop = -Infinity;
          let bodyBot = Infinity;
          for (let k = groupFromIdx; k <= obIdx; k++) {
            const cc = arr[k]!;
            const top = Math.max(cc.open, cc.close);
            const bot = Math.min(cc.open, cc.close);
            if (top > bodyTop) bodyTop = top;
            if (bot < bodyBot) bodyBot = bot;
          }
          return (bodyTop + bodyBot) / 2;
        })();
    const mit = options.useMeanThreshold
      ? findMtMitigation(arr, breakIdx + 1, kind, mtPrice)
      : findMitigation(arr, breakIdx + 1, kind, minPrice, maxPrice);

    const groupStartTime = arr[groupFromIdx]!.timestamp;
    // Open уровень: для одиночной свечи = её open. Для multi-candle
    // берём open первой свечи группы (это начало "противонаправленного"
    // движения, которое поглотится импульсом).
    const openPrice = arr[groupFromIdx]!.open;
    out.push({
      id: `ob-${kind}-${groupStartTime}`,
      kind,
      obTime: groupStartTime,
      startTime: arr[breakIdx]!.timestamp,
      endTime: mit !== null ? mit : lastTime,
      minPrice,
      maxPrice,
      mtPrice,
      openPrice,
      hasFvg,
      unmitigated: mit === null,
      breakKind: sb.kind,
    });
  }

  // Стабильный порядок по startTime — упростит дальнейшую фильтрацию.
  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

// ============================================================================
// Внутренние хелперы
// ============================================================================

/**
 * Бинарный поиск свечи по timestamp. Свечи отсортированы по timestamp.
 * Возвращает индекс точного совпадения или -1.
 */
function findIndexByTime(arr: readonly OhlcCandle[], time: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid]!.timestamp;
    if (v === time) return mid;
    if (v < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Возвращает индекс последней «противонаправленной» свечи в [from..to].
 * Для break↑ — последняя bearish (close < open).
 * Для break↓ — последняя bullish (close > open).
 *
 * Свечи-доджи (close === open) считаем нейтральными — пропускаем.
 */
function findLastOppositeBar(
  arr: readonly OhlcCandle[],
  from: number,
  to: number,
  dir: 'up' | 'down',
): number {
  if (to < from) return -1;
  for (let i = to; i >= from; i--) {
    const c = arr[i]!;
    if (dir === 'up' && c.close < c.open) return i;
    if (dir === 'down' && c.close > c.open) return i;
  }
  return -1;
}

/**
 * Возвращает true, если в диапазоне (obIdx..breakIdx-1) встречается
 * 3-свечный FVG того же направления, что и импульс. Это упрощённый
 * локальный детектор: нам нужно только знать «был ли разрыв», без полной
 * mitigation-проверки.
 *
 *   bull-FVG (для break↑): low[i+1] > high[i-1] — между свечами разрыв вверх;
 *   bear-FVG (для break↓): high[i+1] < low[i-1].
 */
function checkFvgInRange(
  arr: readonly OhlcCandle[],
  obIdx: number,
  breakIdx: number,
  dir: 'up' | 'down',
): boolean {
  // Окно тройки (i-1, i, i+1) должно полностью попадать между obIdx и breakIdx.
  for (let i = obIdx + 1; i < breakIdx; i++) {
    const prev = arr[i - 1]!;
    const next = arr[i + 1]!;
    if (!prev || !next) continue;
    if (dir === 'up' && next.low > prev.high) return true;
    if (dir === 'down' && next.high < prev.low) return true;
  }
  return false;
}

/**
 * Возвращает timestamp первой свечи после `from`, которая зашла внутрь OB.
 *
 *   bull-OB: low[k] ≤ maxPrice — цена коснулась/проколола верхнюю границу;
 *   bear-OB: high[k] ≥ minPrice — цена коснулась/проколола нижнюю границу.
 */
function findMitigation(
  arr: readonly OhlcCandle[],
  from: number,
  kind: 'bull' | 'bear',
  minPrice: number,
  maxPrice: number,
): number | null {
  for (let k = from; k < arr.length; k++) {
    const c = arr[k]!;
    if (kind === 'bull' ? c.low <= maxPrice : c.high >= minPrice) {
      return c.timestamp;
    }
  }
  return null;
}

/**
 * Mitigation по Mean Threshold: OB считается отработанным только когда
 * тело свечи закрылось за уровнем MT.
 *   bull-OB: close <= mtPrice (закрытие ниже середины тела)
 *   bear-OB: close >= mtPrice (закрытие выше середины тела)
 * Касания фитилями игнорируются — это соответствует методике из лекции.
 */
function findMtMitigation(
  arr: readonly OhlcCandle[],
  from: number,
  kind: 'bull' | 'bear',
  mtPrice: number,
): number | null {
  for (let k = from; k < arr.length; k++) {
    const c = arr[k]!;
    if (kind === 'bull' ? c.close <= mtPrice : c.close >= mtPrice) {
      return c.timestamp;
    }
  }
  return null;
}

/**
 * Объединённые границы для multi-candle OB: проходим по всем свечам
 * в диапазоне [from..to] и берём агрегированные границы тем же методом
 * (wicks/body), который выбран для одиночной свечи.
 */
function extractGroupBounds(
  arr: readonly OhlcCandle[],
  from: number,
  to: number,
  mode: ObExtractionMode,
): { minPrice: number; maxPrice: number } {
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (let i = from; i <= to; i++) {
    const b = extractObBounds(arr[i]!, mode);
    if (b.minPrice < minPrice) minPrice = b.minPrice;
    if (b.maxPrice > maxPrice) maxPrice = b.maxPrice;
  }
  return { minPrice, maxPrice };
}

/**
 * Извлекает границы OB по выбранному режиму:
 *   wicks → [low, high]
 *   body  → [min(open,close), max(open,close)]
 *   auto  → wicks, если фитили > тело; иначе body
 */
function extractObBounds(
  c: OhlcCandle,
  mode: ObExtractionMode,
): { minPrice: number; maxPrice: number } {
  if (mode === 'body') {
    return {
      minPrice: Math.min(c.open, c.close),
      maxPrice: Math.max(c.open, c.close),
    };
  }
  if (mode === 'auto') {
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const totalWick = upperWick + lowerWick;
    if (totalWick > body) {
      return { minPrice: c.low, maxPrice: c.high };
    }
    return {
      minPrice: Math.min(c.open, c.close),
      maxPrice: Math.max(c.open, c.close),
    };
  }
  return { minPrice: c.low, maxPrice: c.high };
}

/**
 * Проверяет "поглощение" OB следующей свечой:
 *   bull-OB (dir=up): свеча после break закрылась телом ВЫШЕ тела OB
 *                     (next.close > max(ob.open, ob.close))
 *   bear-OB (dir=down): закрылась ниже тела OB
 * Достаточно одной такой свечи в диапазоне (obIdx .. breakIdx].
 */
function checkAbsorption(
  arr: readonly OhlcCandle[],
  obIdx: number,
  breakIdx: number,
  kind: 'bull' | 'bear',
): boolean {
  const ob = arr[obIdx]!;
  const obBodyTop = Math.max(ob.open, ob.close);
  const obBodyBot = Math.min(ob.open, ob.close);
  for (let k = obIdx + 1; k <= breakIdx; k++) {
    const c = arr[k]!;
    if (kind === 'bull' && c.close > obBodyTop) return true;
    if (kind === 'bear' && c.close < obBodyBot) return true;
  }
  return false;
}

/**
 * Проверяет, "снимает" ли OB-свеча ликвидность:
 *   bull OB (нисходящая свеча перед импульсом вверх) — её low должен
 *     пробить SSL (low-liquidity), сформированную ДО этой свечи.
 *   bear OB — её high должен пробить BSL (high-liquidity).
 */
function candleSweepsLiquidity(
  c: OhlcCandle,
  kind: 'bull' | 'bear',
  zones: readonly LiquidityZone[],
): boolean {
  for (const z of zones) {
    if (z.startTime >= c.timestamp) continue;
    if (kind === 'bull') {
      // SSL = low-liquidity. Свеча проколола её снизу: low <= price.
      if (z.kind === 'low' && c.low <= z.price) return true;
    } else {
      // BSL = high-liquidity. Свеча проколола сверху: high >= price.
      if (z.kind === 'high' && c.high >= z.price) return true;
    }
  }
  return false;
}

/**
 * Проверяет, попадает ли диапазон OB-свечи внутрь ранее сформированного OB.
 * Используется для фильтра "OB на тесте предыдущего блока".
 */
function candleInsidePrevOb(
  c: OhlcCandle,
  priorObs: readonly { obTime: number; minPrice: number; maxPrice: number }[],
): boolean {
  for (const prev of priorObs) {
    if (prev.obTime >= c.timestamp) continue;
    // Пересекаются ли диапазоны [c.low, c.high] и [prev.minPrice, prev.maxPrice]?
    if (c.high < prev.minPrice || c.low > prev.maxPrice) continue;
    return true;
  }
  return false;
}
