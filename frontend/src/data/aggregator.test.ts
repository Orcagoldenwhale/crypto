import { describe, it, expect } from 'vitest';
import { aggregateTo15m } from './aggregator';
import type { Candle5m } from '@/types';

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
