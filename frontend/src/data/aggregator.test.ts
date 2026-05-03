import { describe, it, expect } from 'vitest';
import {
  aggregateTo15m,
  aggregate5mTo15mLtf,
  aggregate5mTo1hLtf,
} from './aggregator';
import type { Candle5m, Cluster } from '@/types';

const MS_5M = 5 * 60 * 1000;

function makeCandle(overrides: Partial<Candle5m> & { timestamp: number }): Candle5m {
  return {
    timestamp: overrides.timestamp,
    open: overrides.open ?? 100,
    high: overrides.high ?? 110,
    low: overrides.low ?? 90,
    close: overrides.close ?? 105,
    volume: overrides.volume ?? 1000,
    delta: overrides.delta ?? 0,
    vpoc_price: overrides.vpoc_price ?? 100,
    max_vol: overrides.max_vol ?? 500,
    delta_at_low: overrides.delta_at_low ?? 0,
    delta_at_high: overrides.delta_at_high ?? 0,
    clusters: overrides.clusters ?? [],
  };
}

describe('aggregateTo15m', () => {
  it('пустой массив → пустой массив', () => {
    expect(aggregateTo15m([])).toEqual([]);
  });

  it('1 свеча 5m → 1 свеча 15m с теми же значениями', () => {
    const c = makeCandle({ timestamp: 0, open: 100, high: 110, low: 90, close: 105, volume: 1000 });
    const result = aggregateTo15m([c]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      timestamp: 0,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    });
  });

  it('3 свечи 5m → 1 свеча 15m с правильными OHLCV', () => {
    const c1 = makeCandle({ timestamp: 0, open: 100, high: 105, low: 95, close: 102, volume: 100 });
    const c2 = makeCandle({
      timestamp: MS_5M,
      open: 102,
      high: 115,
      low: 100,
      close: 110,
      volume: 200,
    });
    const c3 = makeCandle({
      timestamp: 2 * MS_5M,
      open: 110,
      high: 112,
      low: 90,
      close: 95,
      volume: 300,
    });

    const result = aggregateTo15m([c1, c2, c3]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      timestamp: 0,
      open: 100,
      high: 115,
      low: 90,
      close: 95,
      volume: 600,
    });
  });

  it('6 свечей 5m → 2 свечи 15m', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 6; i++) {
      candles.push(
        makeCandle({
          timestamp: i * MS_5M,
          open: 100 + i,
          high: 105 + i,
          low: 95 + i,
          close: 102 + i,
          volume: 100,
        }),
      );
    }
    const result = aggregateTo15m(candles);
    expect(result).toHaveLength(2);

    expect(result[0]?.timestamp).toBe(0);
    expect(result[0]?.open).toBe(100);
    expect(result[0]?.close).toBe(104);
    expect(result[0]?.volume).toBe(300);

    expect(result[1]?.timestamp).toBe(3 * MS_5M);
    expect(result[1]?.open).toBe(103);
    expect(result[1]?.close).toBe(107);
    expect(result[1]?.volume).toBe(300);
  });

  it('Неполный остаток (4 свечи → 2: 3+1)', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 4; i++) {
      candles.push(makeCandle({ timestamp: i * MS_5M, open: 10, high: 20, low: 5, close: 15, volume: 50 }));
    }
    const result = aggregateTo15m(candles);
    expect(result).toHaveLength(2);
    expect(result[1]?.timestamp).toBe(3 * MS_5M);
    expect(result[1]?.volume).toBe(50);
  });

  it('Сохраняет монотонность timestamp', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 30; i++) {
      candles.push(makeCandle({ timestamp: i * MS_5M }));
    }
    const result = aggregateTo15m(candles);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]?.timestamp).toBeGreaterThan(result[i - 1]?.timestamp ?? 0);
    }
  });

  it('1440 свечей 5m (5 дней) → 480 свечей 15m', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 1440; i++) {
      candles.push(makeCandle({ timestamp: i * MS_5M }));
    }
    const result = aggregateTo15m(candles);
    expect(result).toHaveLength(480);
  });
});

// ============================================================================
// LTF-агрегаторы (с merge кластеров): 15m LTF и 1h LTF
// ============================================================================

/** Утилита: одна реальная свеча с двумя кластерами на price=100 и price=105. */
function candleWithClusters(opts: { ts: number; open: number; close: number }): Candle5m {
  const clusters: Cluster[] = [
    { price: 100, bid: 50, ask: 60, vol: 110, delta: 10 },
    { price: 105, bid: 30, ask: 90, vol: 120, delta: 60 },
  ];
  return makeCandle({
    timestamp: opts.ts,
    open: opts.open,
    high: 110,
    low: 95,
    close: opts.close,
    volume: 230,
    delta: 70,
    vpoc_price: 105,
    max_vol: 120,
    delta_at_low: 10,
    delta_at_high: 60,
    clusters,
  });
}

describe('aggregate5mTo15mLtf', () => {
  it('пустой вход → пустой массив', () => {
    expect(aggregate5mTo15mLtf([])).toEqual([]);
  });

  it('3 свечи 5m → 1 свеча 15m с MERGE кластеров (vol суммируется по уровням)', () => {
    const c1 = candleWithClusters({ ts: 0, open: 100, close: 102 });
    const c2 = candleWithClusters({ ts: MS_5M, open: 102, close: 104 });
    const c3 = candleWithClusters({ ts: 2 * MS_5M, open: 104, close: 108 });
    const [out] = aggregate5mTo15mLtf([c1, c2, c3]);
    expect(out).toBeDefined();
    expect(out!.timestamp).toBe(0);
    expect(out!.open).toBe(100);
    expect(out!.close).toBe(108);
    expect(out!.volume).toBe(230 * 3);
    expect(out!.delta).toBe(70 * 3);
    // Кластеры объединены по price → 2 уровня; vol на каждом ×3.
    expect(out!.clusters).toHaveLength(2);
    expect(out!.clusters.find((cl) => cl.price === 100)?.vol).toBe(330);
    expect(out!.clusters.find((cl) => cl.price === 105)?.vol).toBe(360);
    // Volume === sum(clusters.vol) — инвариант формата.
    const sum = out!.clusters.reduce((s, cl) => s + cl.vol, 0);
    expect(out!.volume).toBe(sum);
  });

  it('хвост, не кратный 3, отбрасывается', () => {
    const c = (i: number) => candleWithClusters({ ts: i * MS_5M, open: 100, close: 100 });
    expect(aggregate5mTo15mLtf([c(0), c(1)])).toHaveLength(0);
    expect(aggregate5mTo15mLtf([c(0), c(1), c(2), c(3)])).toHaveLength(1);
  });
});

describe('aggregate5mTo1hLtf', () => {
  it('пустой вход → пустой массив', () => {
    expect(aggregate5mTo1hLtf([])).toEqual([]);
  });

  it('12 свечей 5m → 1 свеча 1h с merge кластеров', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 12; i++) {
      candles.push(candleWithClusters({ ts: i * MS_5M, open: 100, close: 100 }));
    }
    const result = aggregate5mTo1hLtf(candles);
    expect(result).toHaveLength(1);
    const out = result[0]!;
    expect(out.timestamp).toBe(0);
    expect(out.volume).toBe(230 * 12);
    expect(out.delta).toBe(70 * 12);
    expect(out.clusters).toHaveLength(2);
    expect(out.clusters.find((cl) => cl.price === 100)?.vol).toBe(110 * 12);
    expect(out.clusters.find((cl) => cl.price === 105)?.vol).toBe(120 * 12);
    // VPOC корректен (105 имеет больший vol).
    expect(out.vpoc_price).toBe(105);
    // Volume === sum(clusters.vol) — инвариант.
    const sum = out.clusters.reduce((s, cl) => s + cl.vol, 0);
    expect(out.volume).toBe(sum);
  });

  it('хвост, не кратный 12, отбрасывается', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(candleWithClusters({ ts: i * MS_5M, open: 100, close: 100 }));
    }
    // 25 / 12 = 2 полных, 1 в остатке → 2 свечи 1h
    expect(aggregate5mTo1hLtf(candles)).toHaveLength(2);
  });

  it('OHLC берётся с краёв слайса, high/low — экстремумы по слайсу', () => {
    const candles: Candle5m[] = [];
    for (let i = 0; i < 12; i++) {
      // Делаем у одной свечи в середине очень высокий high и очень низкий low.
      const overrides = i === 5 ? { high: 200, low: 50 } : {};
      candles.push({
        ...candleWithClusters({ ts: i * MS_5M, open: 100 + i, close: 100 + i }),
        ...overrides,
      } as Candle5m);
    }
    const out = aggregate5mTo1hLtf(candles)[0]!;
    expect(out.open).toBe(100); // первая свеча
    expect(out.close).toBe(111); // последняя свеча (i=11)
    expect(out.high).toBe(200);
    expect(out.low).toBe(50);
  });
});
