import { describe, expect, it } from 'vitest';
import { findFVGs } from './detectFvg';
import type { Candle15m } from '@/types';

// Миниатюрный билдер свечей: ohlcv опускаем то, что не нужно для FVG.
function c(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle15m {
  return {
    timestamp: ts,
    open,
    high,
    low,
    close,
    volume: 0,
  };
}

const T0 = 1700_000_000_000;
const M15 = 15 * 60 * 1000;

describe('findFVGs', () => {
  it('возвращает пусто при <3 свечах', () => {
    expect(findFVGs([])).toEqual([]);
    expect(findFVGs([c(T0, 1, 2, 0, 1)])).toEqual([]);
    expect(findFVGs([c(T0, 1, 2, 0, 1), c(T0 + M15, 1, 2, 0, 1)])).toEqual(
      [],
    );
  });

  it('детектирует bull-FVG: low[i+1] > high[i-1]', () => {
    // candle 0: high=10
    // candle 1 (displacement): полностью выше зазора
    // candle 2: low=12 > 10 — есть разрыв
    const candles = [
      c(T0, 8, 10, 7, 9),
      c(T0 + M15, 11, 14, 10.5, 13),
      c(T0 + 2 * M15, 13, 15, 12, 14),
    ];
    const fvgs = findFVGs(candles);
    expect(fvgs).toHaveLength(1);
    const f = fvgs[0]!;
    expect(f.kind).toBe('bull');
    expect(f.minPrice).toBe(10);
    expect(f.maxPrice).toBe(12);
    expect(f.startTime).toBe(T0);
    expect(f.unmitigated).toBe(true);
  });

  it('детектирует bear-FVG: high[i+1] < low[i-1]', () => {
    const candles = [
      c(T0, 14, 16, 13, 15),
      c(T0 + M15, 13, 14, 10, 11),
      c(T0 + 2 * M15, 11, 12, 9, 10),
    ];
    const fvgs = findFVGs(candles);
    expect(fvgs).toHaveLength(1);
    const f = fvgs[0]!;
    expect(f.kind).toBe('bear');
    expect(f.minPrice).toBe(12);
    expect(f.maxPrice).toBe(13);
  });

  it('помечает FVG как mitigated, когда цена возвращается внутрь', () => {
    // bull-FVG между 10 и 12. Свеча 4 заходит в зону (low=11) — mitigated.
    const candles = [
      c(T0 + 0 * M15, 8, 10, 7, 9),
      c(T0 + 1 * M15, 11, 14, 10.5, 13),
      c(T0 + 2 * M15, 13, 15, 12, 14),
      c(T0 + 3 * M15, 13, 14, 12.5, 13),
      c(T0 + 4 * M15, 12, 13, 11, 12),
    ];
    const fvgs = findFVGs(candles);
    expect(fvgs).toHaveLength(1);
    expect(fvgs[0]!.unmitigated).toBe(false);
    expect(fvgs[0]!.endTime).toBe(T0 + 4 * M15);
  });

  it('hideMitigated=true прячет отработанные', () => {
    const candles = [
      c(T0 + 0 * M15, 8, 10, 7, 9),
      c(T0 + 1 * M15, 11, 14, 10.5, 13),
      c(T0 + 2 * M15, 13, 15, 12, 14),
      c(T0 + 3 * M15, 12, 13, 11, 12),
    ];
    const all = findFVGs(candles);
    const visible = findFVGs(candles, { hideMitigated: true });
    expect(all).toHaveLength(1);
    expect(all[0]!.unmitigated).toBe(false);
    expect(visible).toHaveLength(0);
  });

  it('не путает обычное движение со разрывом (low<=prev.high)', () => {
    // i+1.low === i-1.high — равенство, не строго больше, разрыва нет.
    const candles = [
      c(T0, 8, 10, 7, 9),
      c(T0 + M15, 9, 12, 8.5, 11),
      c(T0 + 2 * M15, 11, 13, 10, 12),
    ];
    expect(findFVGs(candles)).toEqual([]);
  });

  it('endTime для unmitigated равен timestamp последней свечи', () => {
    const candles = [
      c(T0 + 0 * M15, 8, 10, 7, 9),
      c(T0 + 1 * M15, 11, 14, 10.5, 13),
      c(T0 + 2 * M15, 13, 15, 12, 14),
      c(T0 + 3 * M15, 14, 16, 13, 15),
    ];
    const fvgs = findFVGs(candles);
    expect(fvgs).toHaveLength(1);
    expect(fvgs[0]!.unmitigated).toBe(true);
    expect(fvgs[0]!.endTime).toBe(T0 + 3 * M15);
  });
});
