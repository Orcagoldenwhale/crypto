import { describe, it, expect } from 'vitest';
import { generateMockData, DEFAULT_CANDLES_COUNT } from './mockGenerator';
import type { Candle5m } from '@/types';

const MS_5M = 5 * 60 * 1000;
const TICK_SIZE = 5;

describe('generateMockData — инварианты формата (docs/03-data-format.md)', () => {
  const dataset = generateMockData();

  it('по умолчанию генерирует ровно DEFAULT_CANDLES_COUNT свечей (1440 = 5 дней)', () => {
    expect(DEFAULT_CANDLES_COUNT).toBe(1440);
    expect(dataset.candles).toHaveLength(1440);
    expect(dataset.meta.candles_count).toBe(1440);
  });

  it('meta содержит ожидаемые поля', () => {
    const { meta } = dataset;
    expect(meta.symbol).toBe('BTCUSDT');
    expect(meta.timeframe).toBe('5m');
    expect(meta.tick_size).toBe(TICK_SIZE);
    expect(meta.version).toBe(1);
    expect(meta.exchange).toBe('mock');
    expect(meta.source).toBe('mockGenerator');
    expect(typeof meta.from).toBe('string');
    expect(typeof meta.to).toBe('string');
    expect(typeof meta.generated_at).toBe('string');
  });

  it('timestamp выровнен на 5m сетку и монотонно возрастает', () => {
    const { candles } = dataset;
    expect(candles.length).toBeGreaterThan(0);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      expect(c).toBeDefined();
      expect(c!.timestamp % MS_5M).toBe(0);
      if (i > 0) {
        const prev = candles[i - 1]!;
        expect(c!.timestamp - prev.timestamp).toBe(MS_5M);
      }
    }
  });

  it('каждый кластер: vol === bid + ask и delta === ask - bid', () => {
    for (const c of dataset.candles) {
      for (const cl of c.clusters) {
        expect(cl.vol).toBe(cl.bid + cl.ask);
        expect(cl.delta).toBe(cl.ask - cl.bid);
        expect(cl.bid).toBeGreaterThanOrEqual(0);
        expect(cl.ask).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('каждый кластер: price выровнен на tick_size', () => {
    for (const c of dataset.candles) {
      for (const cl of c.clusters) {
        expect(cl.price % TICK_SIZE).toBe(0);
      }
    }
  });

  it('low ≤ min(open, close) и max(open, close) ≤ high', () => {
    for (const c of dataset.candles) {
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
      expect(Math.max(c.open, c.close)).toBeLessThanOrEqual(c.high);
    }
  });

  it('volume === sum(clusters[].vol)', () => {
    for (const c of dataset.candles) {
      const sum = c.clusters.reduce((s, cl) => s + cl.vol, 0);
      expect(c.volume).toBe(sum);
    }
  });

  it('delta === sum(clusters[].delta)', () => {
    for (const c of dataset.candles) {
      const sum = c.clusters.reduce((s, cl) => s + cl.delta, 0);
      expect(c.delta).toBe(sum);
    }
  });

  it('vpoc_price ∈ clusters[].price и max_vol === max(clusters[].vol)', () => {
    for (const c of dataset.candles) {
      const prices = c.clusters.map((cl) => cl.price);
      expect(prices).toContain(c.vpoc_price);

      const expectedMax = Math.max(...c.clusters.map((cl) => cl.vol));
      expect(c.max_vol).toBe(expectedMax);

      const vpocCluster = c.clusters.find((cl) => cl.price === c.vpoc_price);
      expect(vpocCluster).toBeDefined();
      expect(vpocCluster!.vol).toBe(expectedMax);
    }
  });

  it('delta_at_low соответствует кластеру с price === low', () => {
    for (const c of dataset.candles) {
      const lowCluster = c.clusters.find((cl) => cl.price === c.low);
      expect(lowCluster).toBeDefined();
      expect(c.delta_at_low).toBe(lowCluster!.delta);
    }
  });

  it('delta_at_high соответствует кластеру с price === high', () => {
    for (const c of dataset.candles) {
      const highCluster = c.clusters.find((cl) => cl.price === c.high);
      expect(highCluster).toBeDefined();
      expect(c.delta_at_high).toBe(highCluster!.delta);
    }
  });

  it('clusters отсортированы по возрастанию price без пропусков по сетке', () => {
    for (const c of dataset.candles) {
      for (let i = 1; i < c.clusters.length; i++) {
        const prev = c.clusters[i - 1]!;
        const curr = c.clusters[i]!;
        expect(curr.price).toBe(prev.price + TICK_SIZE);
      }
    }
  });
});

describe('generateMockData — детерминированность', () => {
  it('одинаковый seed даёт побайтово идентичный результат', () => {
    const a = generateMockData({ numCandles: 50, seed: 123 });
    const b = generateMockData({ numCandles: 50, seed: 123 });
    expect(JSON.stringify(a.candles)).toBe(JSON.stringify(b.candles));
  });

  it('разные seed дают разный результат', () => {
    const a = generateMockData({ numCandles: 50, seed: 1 });
    const b = generateMockData({ numCandles: 50, seed: 2 });
    expect(JSON.stringify(a.candles)).not.toBe(JSON.stringify(b.candles));
  });
});

describe('generateMockData — "идеальные" сетапы', () => {
  it('идеальная LONG-свеча проходит все 4 правила сканера', () => {
    const dataset = generateMockData({ numCandles: 100, perfectLongIndex: 50, perfectShortIndex: 90 });
    const c = dataset.candles[50] as Candle5m;

    // Правило 1: close > (high + low) / 2
    expect(c.close).toBeGreaterThan((c.high + c.low) / 2);

    // Правило 2: total_delta > 0
    expect(c.delta).toBeGreaterThan(0);

    // Правило 3: close > vpoc_price
    expect(c.close).toBeGreaterThan(c.vpoc_price);

    // Правило 4: delta_at_low < 0 (поглощение продаж)
    expect(c.delta_at_low).toBeLessThan(0);
  });

  it('идеальная SHORT-свеча проходит все 4 правила сканера (зеркально)', () => {
    const dataset = generateMockData({ numCandles: 100, perfectLongIndex: 10, perfectShortIndex: 50 });
    const c = dataset.candles[50] as Candle5m;

    expect(c.close).toBeLessThan((c.high + c.low) / 2);
    expect(c.delta).toBeLessThan(0);
    expect(c.close).toBeLessThan(c.vpoc_price);
    expect(c.delta_at_high).toBeGreaterThan(0);
  });
});

describe('generateMockData — параметры', () => {
  it('numCandles=10 → 10 свечей', () => {
    const d = generateMockData({ numCandles: 10 });
    expect(d.candles).toHaveLength(10);
  });

  it('кастомный startTimestamp', () => {
    const ts = Date.UTC(2025, 0, 1, 0, 0, 0);
    const d = generateMockData({ numCandles: 3, startTimestamp: ts });
    expect(d.candles[0]?.timestamp).toBe(ts);
    expect(d.candles[2]?.timestamp).toBe(ts + 2 * MS_5M);
  });

  it('кастомный symbol попадает в meta', () => {
    const d = generateMockData({ numCandles: 5, symbol: 'ETHUSDT' });
    expect(d.meta.symbol).toBe('ETHUSDT');
  });
});
