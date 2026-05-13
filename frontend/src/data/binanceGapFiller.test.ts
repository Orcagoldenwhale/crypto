/**
 * Тесты gap filler'а: парсинг REST-ответа, пагинация, потолок MAX_PAGES.
 */

import { describe, expect, it } from 'vitest';
import { fillAggTradeGap, parseAggTradesArray } from './binanceGapFiller';

function fakeAggTrade(id: number, price = 100, qty = 1, m = false, T = 0) {
  return { a: id, p: String(price), q: String(qty), T: T || id * 1000, m };
}

describe('parseAggTradesArray', () => {
  it('валидный массив: распарсен', () => {
    const raw = [fakeAggTrade(1), fakeAggTrade(2)];
    const ticks = parseAggTradesArray(raw);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toMatchObject({ aggTradeId: 1, price: 100, qty: 1 });
  });

  it('non-array → []', () => {
    expect(parseAggTradesArray(null)).toEqual([]);
    expect(parseAggTradesArray({})).toEqual([]);
  });

  it('невалидные элементы тихо пропускаются', () => {
    const raw = [fakeAggTrade(1), { a: 'no' }, null, fakeAggTrade(3)];
    expect(parseAggTradesArray(raw)).toHaveLength(2);
  });
});

describe('fillAggTradeGap', () => {
  function makeFetch(pages: ReadonlyArray<readonly unknown[]>) {
    let i = 0;
    return async (_url: RequestInfo | URL): Promise<Response> => {
      void _url;
      const data = pages[i++] ?? [];
      return {
        ok: true,
        status: 200,
        json: async () => data,
      } as unknown as Response;
    };
  }

  it('пагинация до неполной страницы: останавливается', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, k) => fakeAggTrade(100 + k));
    const lastPage = [fakeAggTrade(1100), fakeAggTrade(1101)];
    const got: number[] = [];
    const result = await fillAggTradeGap({
      symbol: 'BTCUSDT',
      fromId: 100,
      fetchImpl: makeFetch([fullPage, lastPage]) as typeof fetch,
      onPage: (page) => {
        for (const t of page) got.push(t.aggTradeId);
      },
    });
    expect(result.pages).toBe(2);
    expect(result.totalTicks).toBe(1002);
    expect(result.lastAggTradeId).toBe(1101);
    expect(got).toHaveLength(1002);
  });

  it('пустой ответ: pages=1, totalTicks=0, lastId=fromId-1', async () => {
    const result = await fillAggTradeGap({
      symbol: 'X',
      fromId: 100,
      fetchImpl: makeFetch([[]]) as typeof fetch,
      onPage: () => {},
    });
    expect(result.pages).toBe(1);
    expect(result.totalTicks).toBe(0);
    expect(result.lastAggTradeId).toBe(99);
  });

  it('HTTP ошибка → break, ошибка через onError', async () => {
    const errors: unknown[] = [];
    const result = await fillAggTradeGap({
      symbol: 'X',
      fromId: 100,
      fetchImpl: (async () => ({ ok: false, status: 429 } as Response)) as typeof fetch,
      onPage: () => {},
      onError: (e) => errors.push(e),
    });
    expect(errors).toHaveLength(1);
    expect(result.totalTicks).toBe(0);
  });

  it('maxPages соблюдается', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, k) => fakeAggTrade(k));
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => fullPage,
      } as unknown as Response;
    }) as typeof fetch;
    const result = await fillAggTradeGap({
      symbol: 'X',
      fromId: 0,
      fetchImpl,
      onPage: () => {},
      maxPages: 3,
    });
    expect(result.pages).toBe(3);
    expect(calls).toBe(3);
  });
});
