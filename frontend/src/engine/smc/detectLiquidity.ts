/**
 * Детектор скоплений ликвидности (equal highs / equal lows + sweeps).
 *
 * Логика:
 *   1. Находим swing-points: для каждой свечи i проверяем, что её high строго
 *      больше всех high в окне i-lookback..i-1 И i+1..i+lookback. Аналогично
 *      swing-low.
 *   2. Группируем близкие по цене swing-points (внутри equalityTolerancePct
 *      от средней цены группы) — это и есть «двойная вершина», «тройное дно»
 *      и т.п.
 *   3. Для каждой группы проверяем, был ли sweep: первая после группы свеча,
 *      которая пробивает уровень и закрывается обратно (high > level && close < level
 *      для equal-highs; симметрично для lows).
 *
 * Уровни с одним касанием отбрасываем — это просто swing, не «зона ловушки».
 *
 * Все детектируемые группы возвращаются вместе с `sweep` — null, если не было.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { LiquidityZone, SweepEvent } from './types';

interface OhlcCandle {
  timestamp: number;
  high: number;
  low: number;
  close: number;
  open: number;
}

export interface DetectLiquidityOptions {
  /** Окно по lookback с каждой стороны для swing-point. */
  lookback: number;
  /**
   * Допустимая разница между equal-highs/lows как доля от цены.
   * 0 = АВТО: tolerance = медианный размер свечи × ADAPTIVE_TOL_K. Это
   * адаптивно к волатильности монеты и не требует крутить руками при смене
   * символа (BTC vs SOL vs TON).
   * >0 = ручной режим: tolerance = price × equalityTolerancePct (старое
   * поведение, бэкомпат с тестами и сохранёнными настройками).
   */
  equalityTolerancePct: number;
}

/**
 * Доля от медианной свечи, в пределах которой два swing-point считаются
 * «равными» в auto-режиме. 0.3 = эмпирически подобрано: дает разумно широкие
 * группы на крипте, не схлопывая разные уровни. На SOL 5m (medianRange ~$1)
 * это ~$0.30, на BTC 5m ($100) — $30, на TON 5m ($0.02) — $0.006.
 */
const ADAPTIVE_TOL_K = 0.3;

/**
 * Сколько последних свечей берём для медианы. Достаточно небольшого окна —
 * волатильность меняется медленно, а медиана устойчива к выбросам.
 */
const ADAPTIVE_SAMPLE_SIZE = 200;

/**
 * Adaptive абсолютный tolerance из реальной волатильности данных.
 * Возвращает 0 если данных нет (caller должен fallback).
 */
function computeAdaptiveToleranceAbs(arr: readonly OhlcCandle[]): number {
  if (arr.length === 0) return 0;
  const n = Math.min(ADAPTIVE_SAMPLE_SIZE, arr.length);
  const ranges: number[] = new Array(n);
  const start = arr.length - n;
  for (let i = 0; i < n; i++) {
    const c = arr[start + i]!;
    ranges[i] = c.high - c.low;
  }
  ranges.sort((a, b) => a - b);
  const median = ranges[Math.floor(ranges.length / 2)]!;
  return median * ADAPTIVE_TOL_K;
}

/**
 * Возвращает список ловушек ликвидности (equal highs/lows со sweep-меткой).
 */
export function findLiquidityZones(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  options: DetectLiquidityOptions,
): LiquidityZone[] {
  const { lookback, equalityTolerancePct } = options;
  if (candles.length < 2 * lookback + 1) return [];

  const arr = candles as readonly OhlcCandle[];
  const lastTime = arr[arr.length - 1]!.timestamp;

  const swingHighs = findSwingPoints(arr, lookback, 'high');
  const swingLows = findSwingPoints(arr, lookback, 'low');

  // Auto-mode: pct=0 → берём абсолютный tolerance из медианы свечи.
  // Это устойчиво работает на любой монете и волатильности, без ручной
  // подгонки при смене символа.
  const adaptiveAbsTol = equalityTolerancePct === 0
    ? computeAdaptiveToleranceAbs(arr)
    : 0;
  const highGroups = groupByPrice(swingHighs, equalityTolerancePct, adaptiveAbsTol);
  const lowGroups = groupByPrice(swingLows, equalityTolerancePct, adaptiveAbsTol);

  const out: LiquidityZone[] = [];

  for (const group of highGroups) {
    if (group.points.length < 2) continue;
    const sweep = findSweep(arr, group.lastIdx, group.price, 'high');
    out.push(buildZone(group, 'high', lastTime, sweep));
  }
  for (const group of lowGroups) {
    if (group.points.length < 2) continue;
    const sweep = findSweep(arr, group.lastIdx, group.price, 'low');
    out.push(buildZone(group, 'low', lastTime, sweep));
  }

  // Стабильный порядок по startTime — удобно в UI и для дедупликации.
  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

// ============================================================================
// Внутренние хелперы
// ============================================================================

interface SwingPoint {
  index: number;
  time: number;
  price: number;
}

interface PriceGroup {
  /** Средняя цена группы (по членам). */
  price: number;
  /** swing-points, попавшие в группу. */
  points: SwingPoint[];
  /** Индекс последнего swing-point в группе — отсюда ищем sweep. */
  lastIdx: number;
  /** Время первого swing-point — левая граница линии. */
  firstTime: number;
}

function findSwingPoints(
  arr: readonly OhlcCandle[],
  k: number,
  side: 'high' | 'low',
): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = k; i < arr.length - k; i++) {
    const c = arr[i]!;
    const value = side === 'high' ? c.high : c.low;
    let isExtreme = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const other = arr[j]!;
      const otherVal = side === 'high' ? other.high : other.low;
      if (side === 'high' ? otherVal >= value : otherVal <= value) {
        // строгое равенство тоже снимаем — иначе плато даст N-1 «swing-точек».
        // Эквивалентность фиксируется ниже на этапе groupByPrice.
        isExtreme = false;
        break;
      }
    }
    if (isExtreme) points.push({ index: i, time: c.timestamp, price: value });
  }
  return points;
}

/**
 * Группирует swing-points по близости цены.
 *
 * Идея: проходим в порядке времени, для каждого swing-point ищем уже открытую
 * группу, где `|avg - price| / avg <= tolerance`. Если нашли — добавляем,
 * average пересчитываем (running mean).
 */
function groupByPrice(
  points: SwingPoint[],
  tolerancePct: number,
  adaptiveAbsTol: number,
): PriceGroup[] {
  const groups: PriceGroup[] = [];
  for (const p of points) {
    let attached = false;
    for (const g of groups) {
      const diff = Math.abs(g.price - p.price);
      // Auto mode: используем абсолютный tolerance (медиана × K).
      // Manual mode (pct > 0): доля от цены.
      const allowed = adaptiveAbsTol > 0 ? adaptiveAbsTol : g.price * tolerancePct;
      if (diff <= allowed) {
        g.points.push(p);
        // running mean
        g.price =
          g.points.reduce((s, q) => s + q.price, 0) / g.points.length;
        g.lastIdx = p.index;
        attached = true;
        break;
      }
    }
    if (!attached) {
      groups.push({
        price: p.price,
        points: [p],
        lastIdx: p.index,
        firstTime: p.time,
      });
    }
  }
  return groups;
}

function findSweep(
  arr: readonly OhlcCandle[],
  fromIdx: number,
  level: number,
  side: 'high' | 'low',
): SweepEvent | null {
  // Ищем СО СЛЕДУЮЩЕЙ за последним touch-point свечи.
  for (let k = fromIdx + 1; k < arr.length; k++) {
    const c = arr[k]!;
    if (side === 'high') {
      // sweep equal-highs: проколол level и закрылся обратно ниже.
      if (c.high > level && c.close < level) {
        return { time: c.timestamp, extremum: c.high };
      }
    } else {
      if (c.low < level && c.close > level) {
        return { time: c.timestamp, extremum: c.low };
      }
    }
  }
  return null;
}

function buildZone(
  group: PriceGroup,
  kind: 'high' | 'low',
  lastTime: number,
  sweep: SweepEvent | null,
): LiquidityZone {
  return {
    id: `liq-${kind}-${group.firstTime}`,
    kind,
    price: round2dp(group.price),
    startTime: group.firstTime,
    // Если был sweep — линия живёт до момента снятия, иначе до конца данных.
    endTime: sweep ? sweep.time : lastTime,
    touches: group.points.length,
    sweep,
    // Заполняется на этапе аналитики (runSmcAnalysis) когда есть структура.
    position: 'unknown',
  };
}

function round2dp(v: number): number {
  // 1e6 чтобы корректно округлять и большие, и мелкие цены без потерь.
  return Math.round(v * 1e6) / 1e6;
}
