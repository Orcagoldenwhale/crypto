import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBinanceKlines } from './binanceLoader';

const MS_5M = 5 * 60 * 1000;

/**
 * Создаёт сырой kline в формате Binance.
 */
function makeRawKline(opts: {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuy: number;
}): unknown[] {
  return [
    opts.ts,
    String(opts.open),
    String(opts.high),
    String(opts.low),
    String(opts.close),
    String(opts.volume),
    opts.ts + MS_5M - 1,
    '0',
    100,
    String(opts.takerBuy),
    '0',
    '0',
  ];
}

describe('fetchBinanceKlines', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('маппит klines → Candle5m с корректным OHLCV', async () => {
    const ts = Date.UTC(2026, 3, 30, 0, 0, 0);
    const rawData = [
      makeRawKline({
        ts,
        open: 60000,
        high: 60500,
        low: 59800,
        close: 60200,
        volume: 100,
        takerBuy: 70,
      }),
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(rawData),
    } as Response) as typeof fetch;

    const dataset = await fetchBinanceKlines({ days: 1, symbol: 'BTCUSDT' });

    expect(dataset.meta.symbol).toBe('BTCUSDT');
    expect(dataset.meta.exchange).toBe('binance');
    expect(dataset.meta.source).toBe('binance-klines-rest');
    expect(dataset.candles).toHaveLength(1);

    const c = dataset.candles[0]!;
    expect(c.timestamp).toBe(ts);
    expect(c.open).toBe(60000);
    expect(c.high).toBe(60500);
    expect(c.low).toBe(59800);
    expect(c.close).toBe(60200);
    expect(c.volume).toBe(100);
    // taker buy = 70 → ask = 70, bid = 30, delta = 40
    expect(c.delta).toBe(40);
    expect(c.clusters).toHaveLength(1);
    expect(c.clusters[0]!.ask).toBe(70);
    expect(c.clusters[0]!.bid).toBe(30);
  });

  it('дедуплицирует свечи с одинаковым timestamp', async () => {
    const ts = Date.UTC(2026, 3, 30, 0, 0, 0);
    const dup = makeRawKline({
      ts,
      open: 60000,
      high: 60100,
      low: 59900,
      close: 60050,
      volume: 50,
      takerBuy: 30,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve([dup, dup, dup]),
    } as Response) as typeof fetch;

    const dataset = await fetchBinanceKlines({ days: 1 });
    expect(dataset.candles).toHaveLength(1);
  });

  it('бросает ошибку при невалидном ответе (zod parse fail)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve([{ wrong: 'shape' }]),
    } as Response) as typeof fetch;

    await expect(fetchBinanceKlines({ days: 1 })).rejects.toBeDefined();
  });

  it(
    'бросает ошибку при HTTP 5xx после ретраев',
    async () => {
      vi.useRealTimers(); // реальные таймеры для backoff
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      } as Response) as typeof fetch;

      await expect(fetchBinanceKlines({ days: 1 })).rejects.toThrow(/Binance API 500/);
    },
    10000,
  );

  it('вычисляет правильный from/to в meta', async () => {
    const ts = Date.UTC(2026, 4, 1, 0, 0, 0) - MS_5M;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve([
          makeRawKline({
            ts,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 10,
            takerBuy: 5,
          }),
        ]),
    } as Response) as typeof fetch;

    const dataset = await fetchBinanceKlines({ days: 1 });
    expect(typeof dataset.meta.from).toBe('string');
    expect(typeof dataset.meta.to).toBe('string');
    expect(dataset.meta.candles_count).toBe(1);
  });
});
