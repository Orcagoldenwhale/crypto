/**
 * Агрегация 5-минутных свечей:
 *   - 15m OHLC (HTF-разметка без кластеров)
 *   - 1h OHLC (часовой HTF)
 *   - 15m LTF с кластерами (склейка 3×5m footprint для сканера на 15m)
 *
 * Исходный поток: всегда 5m из Python pipeline / Binance Vision.
 */

import type { Candle5m, Candle15m, Candle1h, Cluster } from '@/types';

const CANDLES_PER_15M = 3;
const CANDLES_PER_1H = 12;

export function aggregateTo15m(candles5m: readonly Candle5m[]): Candle15m[] {
  const result: Candle15m[] = [];

  for (let i = 0; i < candles5m.length; i += CANDLES_PER_15M) {
    const first = candles5m[i];
    if (!first) continue;

    let high = first.high;
    let low = first.low;
    let volume = first.volume;
    let last = first;

    const end = Math.min(i + CANDLES_PER_15M, candles5m.length);
    for (let j = i + 1; j < end; j++) {
      const c = candles5m[j];
      if (!c) continue;
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
      last = c;
    }

    result.push({
      timestamp: first.timestamp,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }

  return result;
}

/**
 * Часовая свеча = 12 последовательных 5m (инвариант датасета 1440 = 120×12).
 * Неполный хвост в конце периода склеивается тем же правилом, что и 15m.
 */
export function aggregateTo1h(candles5m: readonly Candle5m[]): Candle1h[] {
  const result: Candle1h[] = [];

  for (let i = 0; i < candles5m.length; i += CANDLES_PER_1H) {
    const first = candles5m[i];
    if (!first) continue;

    let high = first.high;
    let low = first.low;
    let volume = first.volume;
    let last = first;

    const end = Math.min(i + CANDLES_PER_1H, candles5m.length);
    for (let j = i + 1; j < end; j++) {
      const c = candles5m[j];
      if (!c) continue;
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
      last = c;
    }

    result.push({
      timestamp: first.timestamp,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }

  return result;
}

function mergeClustersFromSlice(candles: readonly Candle5m[]): Cluster[] {
  const bucket = new Map<
    number,
    { bid: number; ask: number; vol: number; delta: number }
  >();
  for (const c of candles) {
    for (const cl of c.clusters) {
      const ex = bucket.get(cl.price);
      if (ex) {
        ex.bid += cl.bid;
        ex.ask += cl.ask;
        ex.vol += cl.vol;
        ex.delta += cl.delta;
      } else {
        bucket.set(cl.price, {
          bid: cl.bid,
          ask: cl.ask,
          vol: cl.vol,
          delta: cl.delta,
        });
      }
    }
  }
  const keys = [...bucket.keys()].sort((a, b) => a - b);
  return keys.map((price) => {
    const v = bucket.get(price)!;
    return {
      price,
      bid: v.bid,
      ask: v.ask,
      vol: v.vol,
      delta: v.delta,
    };
  });
}

/** Дельта кластера, ближайшего по цене к уровню (low/high 15m свечи). */
function deltaNearestLevel(clusters: readonly Cluster[], level: number): number {
  if (clusters.length === 0) return 0;
  let best = clusters[0]!;
  let bestD = Math.abs(best.price - level);
  for (let i = 1; i < clusters.length; i++) {
    const cl = clusters[i]!;
    const d = Math.abs(cl.price - level);
    if (d < bestD) {
      best = cl;
      bestD = d;
    }
  }
  return best.delta;
}

function mergeThree5mTo15mLtf(a: Candle5m, b: Candle5m, c: Candle5m): Candle5m {
  const clusters = mergeClustersFromSlice([a, b, c]);
  const high = Math.max(a.high, b.high, c.high);
  const low = Math.min(a.low, b.low, c.low);
  const volume = a.volume + b.volume + c.volume;
  const delta = a.delta + b.delta + c.delta;

  if (clusters.length === 0) {
    return {
      timestamp: a.timestamp,
      open: a.open,
      high,
      low,
      close: c.close,
      volume,
      delta,
      vpoc_price: a.vpoc_price,
      max_vol: 0,
      delta_at_low: 0,
      delta_at_high: 0,
      clusters: [],
    };
  }

  let vpoc_price = clusters[0]!.price;
  let max_vol = clusters[0]!.vol;
  for (let i = 1; i < clusters.length; i++) {
    const cl = clusters[i]!;
    if (cl.vol > max_vol) {
      max_vol = cl.vol;
      vpoc_price = cl.price;
    }
  }

  return {
    timestamp: a.timestamp,
    open: a.open,
    high,
    low,
    close: c.close,
    volume,
    delta,
    vpoc_price,
    max_vol,
    delta_at_low: deltaNearestLevel(clusters, low),
    delta_at_high: deltaNearestLevel(clusters, high),
    clusters,
  };
}

/**
 * Строит 15m LTF с реальными кластерами: каждая свеча = склейка ровно 3×5m.
 * Хвост, не кратный трём, отбрасываем (на «чистом» 1440×5m получается 480 свечей).
 */
export function aggregate5mTo15mLtf(candles5m: readonly Candle5m[]): Candle5m[] {
  const result: Candle5m[] = [];
  for (let i = 0; i + 2 < candles5m.length; i += 3) {
    const a = candles5m[i]!;
    const b = candles5m[i + 1]!;
    const c = candles5m[i + 2]!;
    result.push(mergeThree5mTo15mLtf(a, b, c));
  }
  return result;
}
