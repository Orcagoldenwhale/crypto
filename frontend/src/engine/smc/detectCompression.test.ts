import { describe, it, expect } from 'vitest';
import { detectCompressionZones } from './detectCompression';
import type { Candle15m } from '@/types';

const T0 = 1_700_000_000_000;
const M15 = 15 * 60 * 1000;
const t = (i: number) => T0 + i * M15;

function bar(
  ts: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle15m {
  return { timestamp: ts, open, high, low, close, volume: 0 };
}

describe('detectCompressionZones', () => {
  it('пусто при мало данных', () => {
    const candles: Candle15m[] = [
      bar(t(0), 100, 101, 99, 100),
      bar(t(1), 100, 101, 99, 100),
    ];
    expect(detectCompressionZones(candles, { lookback: 2 })).toEqual([]);
  });

  it('детектирует серию LH (нисходящая коррекция)', () => {
    // Чередуем: low - high - low - high. Каждая high-свеча — строгий
    // локальный максимум (lookback=1). Highs: 110, 108, 106, 104.
    const candles: Candle15m[] = [
      bar(t(0), 100, 100, 99, 100),    // baseline
      bar(t(1), 100, 110, 99, 100),    // SH=110
      bar(t(2), 100, 100, 99, 100),
      bar(t(3), 100, 108, 99, 100),    // SH=108
      bar(t(4), 100, 100, 99, 100),
      bar(t(5), 100, 106, 99, 100),    // SH=106
      bar(t(6), 100, 100, 99, 100),
      bar(t(7), 100, 104, 99, 100),    // SH=104
      bar(t(8), 100, 100, 99, 100),
    ];
    const result = detectCompressionZones(candles, { lookback: 1, minPoints: 3 });
    const down = result.find((c) => c.direction === 'down');
    expect(down).toBeDefined();
    expect(down!.pricePoints.length).toBeGreaterThanOrEqual(3);
    expect(down!.maxPrice).toBe(110);
    expect(down!.minPrice).toBeLessThan(110);
  });

  it('не выдаёт серию короче minPoints', () => {
    // Только 2 LH — недостаточно для серии из 3.
    const candles: Candle15m[] = [
      bar(t(0), 100, 100, 99, 100),
      bar(t(1), 100, 110, 99, 100),    // SH=110
      bar(t(2), 100, 100, 99, 100),
      bar(t(3), 100, 108, 99, 100),    // SH=108
      bar(t(4), 100, 100, 99, 100),
    ];
    expect(detectCompressionZones(candles, { lookback: 1, minPoints: 3 })).toEqual([]);
  });

  it('детектирует серию HL (восходящая коррекция)', () => {
    // Lows: 90, 92, 94, 96 — растущие.
    const candles: Candle15m[] = [
      bar(t(0), 100, 101, 100, 100),
      bar(t(1), 100, 101, 90, 100),    // SL=90
      bar(t(2), 100, 101, 100, 100),
      bar(t(3), 100, 101, 92, 100),    // SL=92
      bar(t(4), 100, 101, 100, 100),
      bar(t(5), 100, 101, 94, 100),    // SL=94
      bar(t(6), 100, 101, 100, 100),
      bar(t(7), 100, 101, 96, 100),    // SL=96
      bar(t(8), 100, 101, 100, 100),
    ];
    const result = detectCompressionZones(candles, { lookback: 1, minPoints: 3 });
    const up = result.find((c) => c.direction === 'up');
    expect(up).toBeDefined();
    expect(up!.pricePoints.length).toBeGreaterThanOrEqual(3);
  });
});
