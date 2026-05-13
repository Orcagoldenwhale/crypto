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
import type { FvgZone, LiquidityZone, ObExtractionMode, OrderBlockZone, StructureBreak } from './types';

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
   * Если true — фитилём свечи тоже можно перекрыть MT (а не только
   * закрытием тела). Имеет смысл когда useMeanThreshold=true.
   */
  mtIncludeWicks?: boolean;
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
  // ============== Аддитивные контексты (лекция OB §3) ==============
  // Каждый тоггл добавляет ещё один проход обнаружения OB поверх базового.
  /** Также искать OB при snake of liquidity (по sweep-событиям). */
  searchAtSweep?: boolean;
  /** Также искать OB при тесте FVG. */
  searchAtFvg?: boolean;
  /** Также искать OB при тесте предыдущего OB. */
  searchAtPrevBlock?: boolean;
  /** Список ликвидных зон (нужен для searchAtSweep). */
  liquidityZones?: readonly LiquidityZone[];
  /** Список FVG (нужен для searchAtFvg). */
  fvgZones?: readonly FvgZone[];
}

export function detectOrderBlocks(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  breaks: readonly StructureBreak[],
  options: DetectOrderBlocksOptions = {},
): OrderBlockZone[] {
  // Раньше тут было `breaks.length === 0 → return []`, но теперь у нас есть
  // аддитивные контекстные проходы (sweep/FVG/prev-OB) которые не требуют
  // структурных пробоев. Поэтому возвращаемся пустым ТОЛЬКО когда нет ни
  // свечей, ни одного включённого контекста.
  if (candles.length === 0) return [];
  const hasContextScan = options.searchAtSweep || options.searchAtFvg || options.searchAtPrevBlock;
  if (breaks.length === 0 && !hasContextScan) return [];
  const arr = candles as readonly OhlcCandle[];
  const lastTime = arr[arr.length - 1]!.timestamp;

  const out: OrderBlockZone[] = [];
  // Дедуп по «отправной» свече и направлению — чтобы серия BOS'ов не
  // плодила копии одного и того же OB. Также используется аддитивными
  // контекстными проходами через mergeContextOb.
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

    // (Контекст формирования — sweep/FVG/prev-OB — теперь обрабатывается
    // отдельными аддитивными проходами ниже после основного BOS-цикла.)

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
      ? findMtMitigation(arr, breakIdx + 1, kind, mtPrice, !!options.mtIncludeWicks)
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

  // ===== Аддитивные контексты (лекция OB §3) =====
  // Каждый контекст ищет OB-кандидатов независимо от BOS и добавляет
  // их в общий список. Дедуп — по (kind, obTime).
  const extraction = options.extraction ?? 'wicks';
  if (options.searchAtSweep && options.liquidityZones?.length) {
    for (const cand of contextScanSweep(arr, options.liquidityZones)) {
      mergeContextOb(arr, cand, extraction, out, seen, lastTime, options);
    }
  }
  if (options.searchAtFvg && options.fvgZones?.length) {
    for (const cand of contextScanFvgTest(arr, options.fvgZones)) {
      mergeContextOb(arr, cand, extraction, out, seen, lastTime, options);
    }
  }
  if (options.searchAtPrevBlock && out.length > 0) {
    // Используем УЖЕ найденные OB как "предыдущие" блоки для теста.
    for (const cand of contextScanPrevOb(arr, out)) {
      mergeContextOb(arr, cand, extraction, out, seen, lastTime, options);
    }
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
 * Mitigation по Mean Threshold: OB считается отработанным когда цена
 * "перекрыла" уровень MT.
 *
 * По умолчанию (includeWicks=false) — только закрытие тела свечи:
 *   bull-OB: close <= mtPrice
 *   bear-OB: close >= mtPrice
 * Касания фитилями игнорируются (классика из лекции).
 *
 * Когда includeWicks=true — также учитываются фитили:
 *   bull-OB: low <= mtPrice (любой прокол фитилём ниже MT)
 *   bear-OB: high >= mtPrice
 */
function findMtMitigation(
  arr: readonly OhlcCandle[],
  from: number,
  kind: 'bull' | 'bear',
  mtPrice: number,
  includeWicks: boolean = false,
): number | null {
  for (let k = from; k < arr.length; k++) {
    const c = arr[k]!;
    const closeBreached = kind === 'bull' ? c.close <= mtPrice : c.close >= mtPrice;
    const wickBreached = includeWicks &&
      (kind === 'bull' ? c.low <= mtPrice : c.high >= mtPrice);
    if (closeBreached || wickBreached) {
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

// (Хелперы candleSweepsLiquidity / candleInsidePrevOb удалены —
// они использовались старой фильтрующей логикой "requireSweep/PrevBlock".
// Теперь sweep и prev-block работают как АДДИТИВНЫЕ контексты ниже.)

// ============================================================================
// Аддитивные контексты обнаружения OB (sweep / FVG-test / prev-OB-test)
// ============================================================================

/**
 * Кандидат OB из контекстного прохода: индекс OB-свечи + направление
 * ожидаемого импульса. Дальше через mergeContextOb превращается в полноценный
 * OrderBlockZone с теми же mitigation/MT правилами что у BOS-based OB.
 */
interface ContextObCandidate {
  obIdx: number;
  kind: 'bull' | 'bear';
  /** Время "триггера" — sweep/FVG-test/prev-OB-test (заменяет breakTime). */
  triggerIdx: number;
}

/** Окна (в свечах) для контекстного поиска. */
const CTX_LOOKBACK = 5;       // как далеко назад от триггера ищем OB-свечу
const CTX_IMPULSE_AHEAD = 3;  // сколько свечей вперёд требуем для подтверждения
const CTX_IMPULSE_CONSEC = 2; // минимум подряд закрывающихся в нужную сторону

function contextScanSweep(
  arr: readonly OhlcCandle[],
  zones: readonly LiquidityZone[],
): ContextObCandidate[] {
  const out: ContextObCandidate[] = [];
  for (const z of zones) {
    if (z.sweep === null) continue;
    const sweepIdx = findIndexByTime(arr, z.sweep.time);
    if (sweepIdx < 0) continue;
    // Снятие SSL (kind=low) → ожидаем импульс вверх → ищем bull-OB.
    // Снятие BSL (kind=high) → импульс вниз → bear-OB.
    const expectedDir: 'up' | 'down' = z.kind === 'low' ? 'up' : 'down';
    const cand = pickContextOb(arr, sweepIdx, expectedDir);
    if (cand !== null) out.push(cand);
  }
  return out;
}

function contextScanFvgTest(
  arr: readonly OhlcCandle[],
  fvgs: readonly FvgZone[],
): ContextObCandidate[] {
  const out: ContextObCandidate[] = [];
  for (const fvg of fvgs) {
    const startIdx = findFirstIndexAtOrAfter(arr, fvg.startTime);
    if (startIdx < 0) continue;
    // Первое касание FVG после её формирования.
    let touchIdx = -1;
    for (let k = startIdx + 1; k < arr.length; k++) {
      const c = arr[k]!;
      const touched = fvg.kind === 'bull'
        ? c.low <= fvg.maxPrice
        : c.high >= fvg.minPrice;
      if (touched) { touchIdx = k; break; }
    }
    if (touchIdx < 0) continue;
    // bull-FVG (gap up) → тест сверху-вниз → ожидаем продолжение вверх → bull-OB.
    // bear-FVG → продолжение вниз → bear-OB.
    const expectedDir: 'up' | 'down' = fvg.kind === 'bull' ? 'up' : 'down';
    const cand = pickContextOb(arr, touchIdx, expectedDir);
    if (cand !== null) out.push(cand);
  }
  return out;
}

function contextScanPrevOb(
  arr: readonly OhlcCandle[],
  priors: readonly OrderBlockZone[],
): ContextObCandidate[] {
  const out: ContextObCandidate[] = [];
  for (const prev of priors) {
    const startIdx = findFirstIndexAtOrAfter(arr, prev.startTime);
    if (startIdx < 0) continue;
    let touchIdx = -1;
    for (let k = startIdx + 1; k < arr.length; k++) {
      const c = arr[k]!;
      // Цена вернулась внутрь зоны (любым краем).
      if (c.high < prev.minPrice || c.low > prev.maxPrice) continue;
      touchIdx = k; break;
    }
    if (touchIdx < 0) continue;
    // Bull OB → ждём отскока вверх → новый bull-OB. Bear OB → bear-OB.
    const expectedDir: 'up' | 'down' = prev.kind === 'bull' ? 'up' : 'down';
    const cand = pickContextOb(arr, touchIdx, expectedDir);
    if (cand !== null) out.push(cand);
  }
  return out;
}

/**
 * Универсальный поиск OB-свечи относительно триггера:
 *   1. Смотрим назад до CTX_LOOKBACK свечей, находим ближайшую к триггеру
 *      противонаправленную (для expectedDir='up' это bearish).
 *   2. Подтверждаем импульсом вперёд: CTX_IMPULSE_CONSEC подряд закрывающихся
 *      в expectedDir свеч в пределах CTX_IMPULSE_AHEAD.
 */
function pickContextOb(
  arr: readonly OhlcCandle[],
  triggerIdx: number,
  expectedDir: 'up' | 'down',
): ContextObCandidate | null {
  let obIdx = -1;
  const from = Math.max(0, triggerIdx - CTX_LOOKBACK);
  for (let i = triggerIdx; i >= from; i--) {
    const c = arr[i]!;
    const opposite = expectedDir === 'up' ? c.close < c.open : c.close > c.open;
    if (opposite) { obIdx = i; break; }
  }
  if (obIdx < 0) return null;

  // Подтверждение импульса.
  let consec = 0;
  let confirmed = false;
  const ahead = Math.min(arr.length, triggerIdx + 1 + CTX_IMPULSE_AHEAD);
  for (let j = triggerIdx + 1; j < ahead; j++) {
    const c = arr[j]!;
    const sameDir = expectedDir === 'up' ? c.close > c.open : c.close < c.open;
    if (sameDir) {
      consec++;
      if (consec >= CTX_IMPULSE_CONSEC) { confirmed = true; break; }
    } else {
      consec = 0;
    }
  }
  if (!confirmed) return null;

  const kind: 'bull' | 'bear' = expectedDir === 'up' ? 'bull' : 'bear';
  return { obIdx, kind, triggerIdx };
}

/**
 * Конвертирует ContextObCandidate в полноценный OrderBlockZone и
 * добавляет в `out`, если такой ещё не зарегистрирован (dedup по
 * (kind, obTime)).
 */
function mergeContextOb(
  arr: readonly OhlcCandle[],
  cand: ContextObCandidate,
  extraction: ObExtractionMode,
  out: OrderBlockZone[],
  seen: Set<string>,
  lastTime: number,
  _options: DetectOrderBlocksOptions,
): void {
  void _options;
  const ob = arr[cand.obIdx]!;
  const key = `${cand.kind}-${ob.timestamp}`;
  if (seen.has(key)) return;
  seen.add(key);

  const bounds = extractObBounds(ob, extraction);
  const mtPrice = (ob.open + ob.close) / 2;
  // Mitigation от триггер-свечи (а не break — её здесь нет).
  const mit = findMitigation(arr, cand.triggerIdx + 1, cand.kind, bounds.minPrice, bounds.maxPrice);

  out.push({
    id: `ob-ctx-${cand.kind}-${ob.timestamp}`,
    kind: cand.kind,
    obTime: ob.timestamp,
    // startTime для контекстного OB = время триггера (когда зона "включилась").
    startTime: arr[cand.triggerIdx]!.timestamp,
    endTime: mit !== null ? mit : lastTime,
    minPrice: bounds.minPrice,
    maxPrice: bounds.maxPrice,
    mtPrice,
    openPrice: ob.open,
    hasFvg: false,
    unmitigated: mit === null,
    breakKind: 'BOS', // отметка — не настоящий BOS, но поле обязательное
  });
}

function findFirstIndexAtOrAfter(arr: readonly OhlcCandle[], time: number): number {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]!.timestamp >= time) return i;
  }
  return -1;
}
