import { describe, it, expect } from 'vitest';
import { detectBreakerBlocks } from './detectBreakerBlocks';
import type { Candle15m } from '@/types';
import type { OrderBlockZone, StructureBreak } from './types';

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

describe('detectBreakerBlocks', () => {
  it('пустой результат если нет mitigated OB', () => {
    const candles: Candle15m[] = [bar(t(0), 10, 11, 9, 10)];
    const obs: OrderBlockZone[] = [
      {
        id: 'ob1',
        kind: 'bull',
        obTime: t(0),
        startTime: t(0),
        endTime: t(0),
        minPrice: 9,
        maxPrice: 10,
        mtPrice: 9.5,
        hasFvg: false,
        unmitigated: true,
        breakKind: 'BOS',
      },
    ];
    const breaks: StructureBreak[] = [];
    expect(detectBreakerBlocks(candles, obs, breaks)).toEqual([]);
  });

  it('bull-OB пробитый вниз → bear-BB', () => {
    // OB существовал и был mitigated, далее произошёл BOS↓.
    const candles: Candle15m[] = [
      bar(t(0), 10, 11, 9, 10),    // OB candle
      bar(t(1), 10, 12, 9, 11),    // mitigation
      bar(t(2), 11, 12, 8, 8.5),   // break candle (BOS down)
      bar(t(3), 8.5, 8.9, 7, 8),   // не достаёт до minPrice=9 — no mit
      bar(t(4), 8, 11, 8, 10.5),   // tests BB zone (high=11 ≥ minPrice=9)
    ];
    const obs: OrderBlockZone[] = [
      {
        id: 'ob1',
        kind: 'bull',
        obTime: t(0),
        startTime: t(0),
        endTime: t(1),
        minPrice: 9,
        maxPrice: 11,
        mtPrice: 10,
        hasFvg: false,
        unmitigated: false,
        breakKind: 'BOS',
      },
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'sb1',
        kind: 'BOS',
        dir: 'down',
        level: 9,
        levelTime: t(0),
        breakTime: t(2),
        retestTime: null,
      },
    ];
    const result = detectBreakerBlocks(candles, obs, breaks);
    expect(result).toHaveLength(1);
    const bb = result[0]!;
    expect(bb.kind).toBe('bear');
    expect(bb.startTime).toBe(t(2));
    expect(bb.minPrice).toBe(9);
    expect(bb.maxPrice).toBe(11);
    expect(bb.sourceObId).toBe('ob1');
    // Свеча 4 (high=11 ≥ minPrice=9) триггерит mitigation.
    expect(bb.unmitigated).toBe(false);
    expect(bb.endTime).toBe(t(4));
  });

  it('bear-OB пробитый вверх → bull-BB', () => {
    const candles: Candle15m[] = [
      bar(t(0), 11, 12, 10, 11),
      bar(t(1), 11, 12, 9, 10),
      bar(t(2), 10, 14, 10, 13.5), // break↑ candle
      bar(t(3), 13.5, 15, 13, 14),
    ];
    const obs: OrderBlockZone[] = [
      {
        id: 'ob1',
        kind: 'bear',
        obTime: t(0),
        startTime: t(0),
        endTime: t(1),
        minPrice: 10,
        maxPrice: 12,
        mtPrice: 11,
        hasFvg: false,
        unmitigated: false,
        breakKind: 'BOS',
      },
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'sb1',
        kind: 'BOS',
        dir: 'up',
        level: 12,
        levelTime: t(0),
        breakTime: t(2),
        retestTime: null,
      },
    ];
    const result = detectBreakerBlocks(candles, obs, breaks);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('bull');
  });
});
