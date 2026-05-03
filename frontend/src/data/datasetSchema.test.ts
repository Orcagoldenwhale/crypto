import { describe, expect, it } from 'vitest';
import { parseDatasetJson, safeParseDatasetJson } from './datasetSchema';

const FIVE_MIN_MS = 5 * 60 * 1000;
const goodCandle = (ts = 1_700_000_000_000) => {
  const aligned = Math.floor(ts / FIVE_MIN_MS) * FIVE_MIN_MS;
  return {
    timestamp: aligned,
    open: 101,
    high: 106,
    low: 99,
    close: 104,
    volume: 13,
    delta: 3,
    vpoc_price: 105,
    max_vol: 10,
    delta_at_low: 0,
    delta_at_high: 0,
    clusters: [
      { price: 100, bid: 1, ask: 2, vol: 3, delta: 1 },
      { price: 105, bid: 4, ask: 6, vol: 10, delta: 2 },
    ],
  };
};
const goodMeta = (count: number) => ({
  symbol: 'BTCUSDT',
  exchange: 'binance',
  timeframe: '5m' as const,
  tick_size: 5,
  from: '2026-04-26T00:00:00Z',
  to: '2026-05-01T00:00:00Z',
  candles_count: count,
  generated_at: '2026-05-02T16:30:00Z',
  source: 'binance-vision-aggTrades',
  version: 1,
});

describe('datasetSchema · happy path', () => {
  it('парсит валидный датасет', () => {
    const ds = { meta: goodMeta(1), candles: [goodCandle()] };
    const parsed = parseDatasetJson(JSON.stringify(ds));
    expect(parsed.candles).toHaveLength(1);
    expect(parsed.meta.symbol).toBe('BTCUSDT');
  });
});

describe('datasetSchema · валидация Cluster', () => {
  it('ловит несовпадение vol = bid+ask', () => {
    const c = goodCandle();
    c.clusters[0]!.vol = 99;
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vol/);
  });

  it('ловит несовпадение delta = ask−bid', () => {
    const c = goodCandle();
    c.clusters[0]!.delta = 99;
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
  });
});

describe('datasetSchema · валидация Candle5m', () => {
  it('ловит timestamp не кратный 5m', () => {
    const c = { ...goodCandle(), timestamp: 1_700_000_000_001 };
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/не кратен 5m/);
  });

  it('ловит high < close', () => {
    const c = goodCandle();
    c.high = 100;
    c.close = 105;
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/high/);
  });

  it('ловит несортированные кластеры', () => {
    const c = goodCandle();
    c.clusters = [...c.clusters].reverse();
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/не отсортированы|дубли/);
  });

  it('ловит несовпадение vpoc_price с реальным VPOC', () => {
    const c = goodCandle();
    c.vpoc_price = 100; // настоящий VPOC = 105
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/vpoc/);
  });

  it('ловит несовпадение Σ vol == volume', () => {
    const c = goodCandle();
    c.volume = 99;
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(1), candles: [c] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/volume/);
  });
});

describe('datasetSchema · валидация Dataset', () => {
  it('ловит несовпадение meta.candles_count', () => {
    const ds = { meta: goodMeta(99), candles: [goodCandle()] };
    const r = safeParseDatasetJson(JSON.stringify(ds));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/candles_count/);
  });

  it('ловит несортированные свечи', () => {
    const c1 = goodCandle(1_700_000_300_000);
    const c2 = goodCandle(1_700_000_000_000);
    const r = safeParseDatasetJson(JSON.stringify({ meta: goodMeta(2), candles: [c1, c2] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/отсортированы|дубли/);
  });

  it('ловит лишние поля (strict)', () => {
    const ds = { meta: goodMeta(1), candles: [goodCandle()], extra_field: 'oops' };
    const r = safeParseDatasetJson(JSON.stringify(ds));
    expect(r.ok).toBe(false);
  });

  it('ловит невалидный JSON', () => {
    const r = safeParseDatasetJson('{not valid json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON parse error/);
  });
});
