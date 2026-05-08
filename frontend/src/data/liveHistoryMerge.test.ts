import { describe, expect, it } from 'vitest';
import { mergeRaw5mWithLive } from './liveHistoryMerge';
import type { Candle5m } from '@/types';

function emptyCandle(ts: number, close: number): Candle5m {
  return {
    timestamp: ts,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
    delta: 0,
    vpoc_price: close,
    max_vol: 0,
    delta_at_low: 0,
    delta_at_high: 0,
    clusters: [],
  };
}

function candle(ts: number, close: number): Candle5m {
  const c = emptyCandle(ts, close);
  return {
    ...c,
    clusters: [
      { price: close, bid: 0, ask: 1, vol: 1, delta: 1 },
    ],
    volume: 1,
    delta: 1,
    max_vol: 1,
  };
}

describe('mergeRaw5mWithLive', () => {
  it('без live-данных возвращает тот же reference history', () => {
    const h: Candle5m[] = [candle(1000, 10)];
    expect(mergeRaw5mWithLive(h, [], null)).toBe(h);
  });

  it('live open с тем же timestamp что и последняя история — заменяет её', () => {
    const hist = [candle(0, 5), candle(1000, 10)];
    const liveOpen = candle(1000, 99);
    const merged = mergeRaw5mWithLive(hist, [], liveOpen);
    expect(merged).toHaveLength(2);
    expect(merged[1]?.close).toBe(99);
  });

  it('live open на новом слоте — дописывается', () => {
    const hist = [candle(0, 5), candle(1000, 10)];
    const liveOpen = candle(1300, 12);
    const merged = mergeRaw5mWithLive(hist, [], liveOpen);
    expect(merged).toHaveLength(3);
    expect(merged[2]?.close).toBe(12);
  });

  it('закрытые live свечи и open применяются по порядку', () => {
    const hist = [candle(0, 1)];
    const closed = [candle(1000, 2), candle(1300, 3)];
    const open = candle(1600, 4);
    const merged = mergeRaw5mWithLive(hist, closed, open);
    expect(merged.map((c) => c.timestamp)).toEqual([0, 1000, 1300, 1600]);
  });

  it('закрытая live с тем же ts что последняя история — замена', () => {
    const hist = [candle(1000, 10)];
    const closed = [candle(1000, 77)];
    const merged = mergeRaw5mWithLive(hist, closed, null);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.close).toBe(77);
  });
});
