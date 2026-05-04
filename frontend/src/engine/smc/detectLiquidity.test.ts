import { describe, expect, it } from 'vitest';
import { findLiquidityZones } from './detectLiquidity';
import type { Candle15m } from '@/types';

function c(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle15m {
  return { timestamp: ts, open, high, low, close, volume: 0 };
}

const T0 = 1700_000_000_000;
const M15 = 15 * 60 * 1000;
const t = (i: number): number => T0 + i * M15;

describe('findLiquidityZones', () => {
  it('возвращает пусто, если данных меньше 2*lookback+1', () => {
    expect(
      findLiquidityZones([], { lookback: 3, equalityTolerancePct: 0.001 }),
    ).toEqual([]);
  });

  it('детектирует двойную вершину (equal highs)', () => {
    // Создаём 13 свечей: два пика на high=12 примерно одинаковые.
    // Между ними — низкая swing-точка, чтобы пики были раздельные.
    // lookback=3, нужно по 3 свечи слева/справа от каждого пика.
    const candles: Candle15m[] = [
      c(t(0), 10, 11, 9, 10),
      c(t(1), 10, 11, 9, 10),
      c(t(2), 10, 11, 9, 10),
      c(t(3), 10, 12, 9, 11), // peak #1: high=12
      c(t(4), 11, 11.5, 9, 10),
      c(t(5), 10, 11, 8, 9),
      c(t(6), 9, 10.5, 8, 10), // valley
      c(t(7), 10, 11, 9, 10),
      c(t(8), 10, 11, 9, 10),
      c(t(9), 10, 12, 9, 11), // peak #2: high=12 (== peak #1)
      c(t(10), 10, 11, 9, 10),
      c(t(11), 10, 11, 9, 10),
      c(t(12), 10, 11, 9, 10),
    ];
    const zones = findLiquidityZones(candles, {
      lookback: 3,
      equalityTolerancePct: 0.001,
    });
    expect(zones).toHaveLength(1);
    const z = zones[0]!;
    expect(z.kind).toBe('high');
    expect(z.touches).toBe(2);
    expect(z.price).toBeCloseTo(12, 5);
    expect(z.startTime).toBe(t(3));
    expect(z.sweep).toBeNull();
  });

  it('детектирует sweep (свеча проколола уровень и закрылась обратно)', () => {
    // Двойная вершина на 12, потом свеча с high=12.5 и close=11.5 → sweep.
    const candles: Candle15m[] = [
      c(t(0), 10, 11, 9, 10),
      c(t(1), 10, 11, 9, 10),
      c(t(2), 10, 11, 9, 10),
      c(t(3), 10, 12, 9, 11),
      c(t(4), 11, 11.5, 9, 10),
      c(t(5), 10, 11, 8, 9),
      c(t(6), 9, 10.5, 8, 10),
      c(t(7), 10, 11, 9, 10),
      c(t(8), 10, 11, 9, 10),
      c(t(9), 10, 12, 9, 11),
      c(t(10), 10, 11, 9, 10),
      c(t(11), 10, 11, 9, 10),
      c(t(12), 10, 11, 9, 10),
      c(t(13), 11, 12.5, 11, 11.5), // sweep свеча
      c(t(14), 11, 11.5, 10, 10.5),
    ];
    const zones = findLiquidityZones(candles, {
      lookback: 3,
      equalityTolerancePct: 0.001,
    });
    expect(zones).toHaveLength(1);
    const z = zones[0]!;
    expect(z.sweep).not.toBeNull();
    expect(z.sweep!.time).toBe(t(13));
    expect(z.sweep!.extremum).toBe(12.5);
    expect(z.endTime).toBe(t(13));
  });

  it('детектирует двойное дно (equal lows)', () => {
    const candles: Candle15m[] = [
      c(t(0), 10, 11, 9.5, 10),
      c(t(1), 10, 11, 9.5, 10),
      c(t(2), 10, 11, 9.5, 10),
      c(t(3), 10, 11, 8, 10), // bottom #1: low=8
      c(t(4), 10, 11, 9, 10),
      c(t(5), 10, 11, 9.5, 10),
      c(t(6), 10, 11, 9, 10), // top
      c(t(7), 10, 11, 9.5, 10),
      c(t(8), 10, 11, 9.5, 10),
      c(t(9), 10, 11, 8, 10), // bottom #2: low=8
      c(t(10), 10, 11, 9.5, 10),
      c(t(11), 10, 11, 9.5, 10),
      c(t(12), 10, 11, 9.5, 10),
    ];
    const zones = findLiquidityZones(candles, {
      lookback: 3,
      equalityTolerancePct: 0.001,
    });
    expect(zones).toHaveLength(1);
    const z = zones[0]!;
    expect(z.kind).toBe('low');
    expect(z.touches).toBe(2);
    expect(z.price).toBeCloseTo(8, 5);
  });

  it('одиночный swing (без второй точки) не возвращается как зона', () => {
    const candles: Candle15m[] = [
      c(t(0), 10, 11, 9, 10),
      c(t(1), 10, 11, 9, 10),
      c(t(2), 10, 11, 9, 10),
      c(t(3), 10, 12, 9, 11), // одиночный пик
      c(t(4), 10, 11, 9, 10),
      c(t(5), 10, 11, 9, 10),
      c(t(6), 10, 11, 9, 10),
    ];
    const zones = findLiquidityZones(candles, {
      lookback: 3,
      equalityTolerancePct: 0.001,
    });
    expect(zones).toHaveLength(0);
  });

  it('пики далеко друг от друга по цене не сливаются в группу', () => {
    const candles: Candle15m[] = [
      c(t(0), 10, 11, 9, 10),
      c(t(1), 10, 11, 9, 10),
      c(t(2), 10, 11, 9, 10),
      c(t(3), 10, 12, 9, 11), // peak A: 12
      c(t(4), 10, 11, 9, 10),
      c(t(5), 10, 11, 9, 10),
      c(t(6), 10, 11, 9, 10),
      c(t(7), 10, 11, 9, 10),
      c(t(8), 10, 11, 9, 10),
      c(t(9), 10, 20, 9, 11), // peak B: 20 — не equal
      c(t(10), 10, 11, 9, 10),
      c(t(11), 10, 11, 9, 10),
      c(t(12), 10, 11, 9, 10),
    ];
    const zones = findLiquidityZones(candles, {
      lookback: 3,
      equalityTolerancePct: 0.001, // 0.1%
    });
    expect(zones).toHaveLength(0);
  });
});
