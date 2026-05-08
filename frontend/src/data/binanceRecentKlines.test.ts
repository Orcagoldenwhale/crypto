/**
 * Тесты лёгкого klines-loader'а: парсинг, обрезка открытой свечи, ошибки.
 */

import { describe, expect, it } from 'vitest';
import { fetchRecentKlines5m, parseKlinesArray } from './binanceRecentKlines';

const MS_5M = 5 * 60 * 1000;

function fakeKline(openTime: number, close = '100', takerBuy = '0.5', vol = '1'): unknown[] {
  return [openTime, '100', '101', '99', close, vol, openTime + 299_999, '100', 1, takerBuy, '50', '0'];
}

describe('parseKlinesArray', () => {
  it('валидный массив парсится корректно', () => {
    const raw = [fakeKline(1000), fakeKline(1000 + MS_5M)];
    const c = parseKlinesArray(raw);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ timestamp: 1000, open: 100, high: 101, low: 99 });
    expect(c[0]?.clusters).toHaveLength(0);
  });

  it('delta = 2*takerBuy - vol', () => {
    const raw = [fakeKline(1000, '100', '0.7', '1')];
    const c = parseKlinesArray(raw);
    expect(c[0]?.delta).toBeCloseTo(2 * 0.7 - 1, 9);
  });

  it('non-array → []', () => {
    expect(parseKlinesArray(null)).toEqual([]);
    expect(parseKlinesArray('x')).toEqual([]);
  });

  it('битый элемент пропускается, остальные парсятся', () => {
    const raw = [fakeKline(1000), null, [1, 2], fakeKline(2000)];
    expect(parseKlinesArray(raw)).toHaveLength(2);
  });
});

describe('fetchRecentKlines5m', () => {
  it('делает один запрос, возвращает закрытые свечи', async () => {
    const slot = Math.floor(Date.now() / MS_5M) * MS_5M;
    const closedSlot = slot - MS_5M;
    let calledUrl = '';
    const fetchImpl: typeof fetch = (async (url: RequestInfo | URL) => {
      calledUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => [fakeKline(closedSlot - MS_5M), fakeKline(closedSlot)],
      } as unknown as Response;
    }) as typeof fetch;

    const result = await fetchRecentKlines5m({
      symbol: 'BTCUSDT',
      limit: 100,
      fetchImpl,
    });
    expect(result).toHaveLength(2);
    expect(calledUrl).toContain('symbol=BTCUSDT');
    expect(calledUrl).toContain('interval=5m');
    expect(calledUrl).toContain('limit=100');
  });

  it('обрезает свечу с текущим открытым слотом (excludeOpen=true)', async () => {
    const slot = Math.floor(Date.now() / MS_5M) * MS_5M;
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => [fakeKline(slot - MS_5M), fakeKline(slot)],
      }) as unknown as Response) as typeof fetch;

    const result = await fetchRecentKlines5m({
      symbol: 'BTCUSDT',
      fetchImpl,
    });
    // Свеча с timestamp=slot должна быть отброшена.
    expect(result).toHaveLength(1);
    expect(result[0]?.timestamp).toBeLessThan(slot);
  });

  it('HTTP-ошибка пробрасывает Error c msg из тела', async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: false,
        status: 429,
        json: async () => ({ code: -1003, msg: 'Too many requests' }),
      }) as unknown as Response) as typeof fetch;
    await expect(
      fetchRecentKlines5m({ symbol: 'X', fetchImpl }),
    ).rejects.toThrow(/429.*Too many requests/);
  });

  it('Binance error JSON {code,msg} вместо массива → понятная ошибка', async () => {
    const fetchImpl: typeof fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ code: -1121, msg: 'Invalid symbol.' }),
      }) as unknown as Response) as typeof fetch;
    await expect(
      fetchRecentKlines5m({ symbol: 'BAD', fetchImpl }),
    ).rejects.toThrow(/Invalid symbol/);
  });

  it('сетевая ошибка fetch (CORS / DNS) → понятная ошибка', async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(
      fetchRecentKlines5m({ symbol: 'X', fetchImpl }),
    ).rejects.toThrow(/network error.*Failed to fetch/);
  });
});
