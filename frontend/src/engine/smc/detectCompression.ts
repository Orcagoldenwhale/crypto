/**
 * Детектор Compression — последовательностей swing-точек одной полярности
 * с монотонным изменением цены. Это коррекционные движения, формирующие
 * pool ликвидности на каждой промежуточной экстремум-точке.
 *
 * Алгоритм:
 *   1. Находим все swing-highs и swing-lows (тем же методом, что
 *      используется в detectStructure / detectLiquidity).
 *   2. Идём по swing-highs, ищем непрерывные сегменты, где каждая следующая
 *      точка строго ниже предыдущей (LH) — это коррекция вниз.
 *   3. Аналогично по swing-lows: ищем сегменты с возрастающими ценами (HL) —
 *      коррекция вверх.
 *   4. Сегменты длиной >= minPoints выпускаем как CompressionZone.
 *
 * Пересекающиеся серии не объединяем — это разные коррекционные эпизоды.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { CompressionZone } from './types';

interface OhlcCandle {
  timestamp: number;
  high: number;
  low: number;
}

interface SwingPoint {
  time: number;
  price: number;
}

export interface DetectCompressionOptions {
  /** Окно для поиска swing-точек (та же логика что в structure/liquidity). */
  lookback: number;
  /** Минимальное число точек в серии. По умолчанию 3. */
  minPoints?: number;
}

export function detectCompressionZones(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  options: DetectCompressionOptions,
): CompressionZone[] {
  const { lookback, minPoints = 3 } = options;
  if (candles.length < 2 * lookback + 1) return [];
  const arr = candles as readonly OhlcCandle[];

  const highs = findSwingPoints(arr, lookback, 'high');
  const lows = findSwingPoints(arr, lookback, 'low');

  const out: CompressionZone[] = [];

  // Коррекция вниз: серия LH (each next high < previous).
  collectMonotonicRuns(highs, '<', minPoints).forEach((run) => {
    out.push({
      id: `comp-down-${run[0]!.time}`,
      direction: 'down',
      startTime: run[0]!.time,
      endTime: run[run.length - 1]!.time,
      // run отсортирован по времени; для down highs: первый = max, последний = min
      maxPrice: run[0]!.price,
      minPrice: run[run.length - 1]!.price,
      pricePoints: run,
    });
  });

  // Коррекция вверх: серия HL (each next low > previous).
  collectMonotonicRuns(lows, '>', minPoints).forEach((run) => {
    out.push({
      id: `comp-up-${run[0]!.time}`,
      direction: 'up',
      startTime: run[0]!.time,
      endTime: run[run.length - 1]!.time,
      maxPrice: run[run.length - 1]!.price,
      minPrice: run[0]!.price,
      pricePoints: run,
    });
  });

  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

function findSwingPoints(
  arr: readonly OhlcCandle[],
  lookback: number,
  kind: 'high' | 'low',
): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = lookback; i < arr.length - lookback; i++) {
    const c = arr[i]!;
    const value = kind === 'high' ? c.high : c.low;
    let isExtreme = true;
    for (let k = i - lookback; k <= i + lookback; k++) {
      if (k === i) continue;
      const other = arr[k]!;
      const otherValue = kind === 'high' ? other.high : other.low;
      if (kind === 'high' ? otherValue >= value : otherValue <= value) {
        isExtreme = false;
        break;
      }
    }
    if (isExtreme) out.push({ time: c.timestamp, price: value });
  }
  return out;
}

/**
 * Находит непрерывные подпоследовательности, где соседние точки
 * удовлетворяют compare ('<' или '>'). Возвращает только run'ы длиной >= minLen.
 */
function collectMonotonicRuns(
  points: readonly SwingPoint[],
  compare: '<' | '>',
  minLen: number,
): SwingPoint[][] {
  const runs: SwingPoint[][] = [];
  let cur: SwingPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (cur.length === 0) {
      cur.push(p);
      continue;
    }
    const prev = cur[cur.length - 1]!;
    const ok = compare === '<' ? p.price < prev.price : p.price > prev.price;
    if (ok) {
      cur.push(p);
    } else {
      if (cur.length >= minLen) runs.push(cur);
      cur = [p];
    }
  }
  if (cur.length >= minLen) runs.push(cur);
  return runs;
}
