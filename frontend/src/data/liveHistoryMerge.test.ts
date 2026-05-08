import { describe, expect, it } from 'vitest';
import { mergeRaw5mWithLive, mergeRaw5mWithKlines } from './liveHistoryMerge';
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

describe('mergeRaw5mWithKlines', () => {
  it('пустые klines → возвращает history reference', () => {
    const h: Candle5m[] = [candle(1000, 10)];
    expect(mergeRaw5mWithKlines(h, [])).toBe(h);
  });

  it('пустая history → возвращает копию klines (отсортированную)', () => {
    const klines = [emptyCandle(2000, 20), emptyCandle(1000, 10)];
    const merged = mergeRaw5mWithKlines([], klines);
    expect(merged.map((c) => c.timestamp)).toEqual([1000, 2000]);
  });

  it('klines БЕЗ кластеров не выбрасываются (главное отличие от mergeRaw5mWithLive)', () => {
    const hist: Candle5m[] = [];
    const klines = [emptyCandle(1000, 10), emptyCandle(2000, 20)];
    const merged = mergeRaw5mWithKlines(hist, klines);
    expect(merged).toHaveLength(2);
    expect(merged.every((c) => c.clusters.length === 0)).toBe(true);
  });

  it('непересекающиеся timestamps — обе стороны сохраняются, ASC', () => {
    const hist = [candle(1000, 10), candle(2000, 20)]; // c кластерами
    const klines = [emptyCandle(3000, 30), emptyCandle(4000, 40)]; // без кластеров
    const merged = mergeRaw5mWithKlines(hist, klines);
    expect(merged.map((c) => c.timestamp)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('пересекающиеся timestamps — history побеждает (сохраняем кластеры)', () => {
    const hist = [candle(1000, 10), candle(2000, 20)];
    const klines = [emptyCandle(2000, 999), emptyCandle(3000, 30)];
    const merged = mergeRaw5mWithKlines(hist, klines);
    expect(merged).toHaveLength(3);
    const at2000 = merged.find((c) => c.timestamp === 2000)!;
    expect(at2000.close).toBe(20);
    expect(at2000.clusters.length).toBe(1);
  });

  it('результат всегда отсортирован по timestamp ASC', () => {
    const hist = [candle(5000, 5), candle(1000, 1)]; // намеренно не отсортирован
    const klines = [emptyCandle(3000, 3), emptyCandle(2000, 2)];
    const merged = mergeRaw5mWithKlines(hist, klines);
    expect(merged.map((c) => c.timestamp)).toEqual([1000, 2000, 3000, 5000]);
  });
});
