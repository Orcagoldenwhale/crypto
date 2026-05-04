/**
 * Детектор рыночной структуры: BOS (Break of Structure) и CHoCH
 * (Change of Character) с поиском retest'ов.
 *
 * Алгоритм:
 *   1. Находим все swing-points (high и low) с окном `lookback` слева/справа.
 *   2. Идём по свечам в хронологическом порядке. Каждый swing-point становится
 *      «активным» (защищающим уровнем) только после того, как прошло lookback
 *      свечей справа от него — раньше это знание у трейдера ещё нет.
 *   3. На каждой свече смотрим её close:
 *        - close > activeHigh.price → break↑ (BOS если trend уже 'up' или null,
 *          CHoCH если trend был 'down'). После break activeHigh «снимается»;
 *          его место займёт следующий новый swing-high, как только он подтвердится.
 *        - close < activeLow.price → симметрично, break↓.
 *   4. После фиксации break ищем retest: первая свеча `r > breakIdx`, чей low
 *      (для up-break) или high (для down-break) КОСНУЛСЯ сломанного уровня.
 *
 * Особенности:
 *   - Если на одной свече одновременно close ломает и high, и low (всё-таки
 *     один свеч может ломать только один уровень разумного размера, но
 *     теоретически), приоритет — у направления текущего тренда.
 *   - Активный уровень на момент initial trend = null определяется по самому
 *     раннему доступному swing'у; первый break при null-trend помечается
 *     как BOS (продолжение «нулевого» тренда в его направлении).
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { StructureBreak } from './types';

interface OhlcCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Swing {
  /** Индекс свечи в исходном массиве. */
  index: number;
  time: number;
  price: number;
  side: 'high' | 'low';
}

export interface DetectStructureOptions {
  lookback: number;
}

export function detectStructure(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  options: DetectStructureOptions,
): StructureBreak[] {
  const { lookback } = options;
  if (candles.length < 2 * lookback + 1) return [];

  const arr = candles as readonly OhlcCandle[];
  const swingsAsc = collectSwings(arr, lookback);
  if (swingsAsc.length < 2) return [];

  // Очередь swing'ов в порядке появления — выберем нужный, когда дойдём до
  // его момента «созревания» (index + lookback).
  let swingCursor = 0;

  let activeHigh: Swing | null = null;
  let activeLow: Swing | null = null;
  let trend: 'up' | 'down' | null = null;
  const breaks: StructureBreak[] = [];

  for (let i = 0; i < arr.length; i++) {
    // Активируем все swing'и, чьи lookback уже прошли.
    while (
      swingCursor < swingsAsc.length &&
      swingsAsc[swingCursor]!.index + lookback <= i
    ) {
      const s = swingsAsc[swingCursor]!;
      if (s.side === 'high') activeHigh = s;
      else activeLow = s;
      swingCursor++;
    }

    const c = arr[i]!;

    // BREAK↑: close превзошёл активный swing-high. Возможно только если
    // у нас вообще есть activeHigh и i > activeHigh.index (не та же свеча).
    if (activeHigh && i > activeHigh.index && c.close > activeHigh.price) {
      const kind: StructureBreak['kind'] = trend === 'down' ? 'CHoCH' : 'BOS';
      breaks.push({
        id: `${kind === 'BOS' ? 'bos' : 'choch'}-up-${activeHigh.time}`,
        kind,
        dir: 'up',
        level: activeHigh.price,
        levelTime: activeHigh.time,
        breakTime: c.timestamp,
        retestTime: findRetest(arr, i, activeHigh.price, 'up'),
      });
      trend = 'up';
      activeHigh = null;
      continue;
    }

    // BREAK↓: close ниже активного swing-low.
    if (activeLow && i > activeLow.index && c.close < activeLow.price) {
      const kind: StructureBreak['kind'] = trend === 'up' ? 'CHoCH' : 'BOS';
      breaks.push({
        id: `${kind === 'BOS' ? 'bos' : 'choch'}-down-${activeLow.time}`,
        kind,
        dir: 'down',
        level: activeLow.price,
        levelTime: activeLow.time,
        breakTime: c.timestamp,
        retestTime: findRetest(arr, i, activeLow.price, 'down'),
      });
      trend = 'down';
      activeLow = null;
    }
  }

  return breaks;
}

// ============================================================================
// Внутренние хелперы
// ============================================================================

/**
 * Возвращает все swing-points (high и low) отсортированные по индексу свечи.
 * При плато (несколько свечей с одинаковым high) ни одна не считается
 * экстремумом — это сразу отсекает мусор и совместимо с detectLiquidity.
 */
function collectSwings(arr: readonly OhlcCandle[], k: number): Swing[] {
  const swings: Swing[] = [];
  for (let i = k; i < arr.length - k; i++) {
    const c = arr[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const o = arr[j]!;
      if (o.high >= c.high) isHigh = false;
      if (o.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) swings.push({ index: i, time: c.timestamp, price: c.high, side: 'high' });
    if (isLow) swings.push({ index: i, time: c.timestamp, price: c.low, side: 'low' });
  }
  // Стабильный порядок по индексу. Если на одной свече одновременно high и low —
  // (вырожденный случай) — детерминированно в порядке push'а.
  swings.sort((a, b) => a.index - b.index);
  return swings;
}

function findRetest(
  arr: readonly OhlcCandle[],
  fromIdx: number,
  level: number,
  dir: 'up' | 'down',
): number | null {
  for (let r = fromIdx + 1; r < arr.length; r++) {
    const c = arr[r]!;
    if (dir === 'up') {
      // up-break: уровень был сопротивлением, теперь поддержка. Retest = касание low.
      if (c.low <= level) return c.timestamp;
    } else {
      if (c.high >= level) return c.timestamp;
    }
  }
  return null;
}
