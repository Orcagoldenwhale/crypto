import { describe, expect, it } from 'vitest';
import { detectOrderBlocks } from './detectOrderBlocks';
import type { Candle15m } from '@/types';
import type { StructureBreak } from './types';

function bar(
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

describe('detectOrderBlocks', () => {
  it('пусто, если нет ни свечей, ни breaks', () => {
    expect(detectOrderBlocks([], [])).toEqual([]);
    const candles = [bar(t(0), 1, 2, 0, 1), bar(t(1), 1, 2, 0, 1)];
    expect(detectOrderBlocks(candles, [])).toEqual([]);
    expect(
      detectOrderBlocks([], [
        {
          id: 'b',
          kind: 'BOS',
          dir: 'up',
          level: 1,
          levelTime: t(0),
          breakTime: t(1),
          retestTime: null,
        },
      ]),
    ).toEqual([]);
  });

  it('Bull OB: последняя bearish-свеча перед break↑', () => {
    // Структура: swing-high на i=2 (high=10). Между i=2 и i=5 одна bearish свеча
    // на i=3 (open=9, close=8.5), потом два бычьих бара. Break на i=5 (close=11).
    const candles: Candle15m[] = [
      bar(t(0), 8, 9, 7, 9),
      bar(t(1), 9, 9.5, 8, 9.5),
      bar(t(2), 9.5, 10, 9, 9.8),     // swing-high (level=10)
      bar(t(3), 9.8, 9.9, 8.5, 8.5),  // bearish — кандидат на bull-OB
      bar(t(4), 8.5, 9.5, 8.4, 9.5),
      bar(t(5), 9.5, 11.5, 9.4, 11),  // break↑ (close=11 > 10)
      bar(t(6), 11, 12, 10.5, 11.5),
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'bos-1',
        kind: 'BOS',
        dir: 'up',
        level: 10,
        levelTime: t(2),
        breakTime: t(5),
        retestTime: null,
      },
    ];
    const obs = detectOrderBlocks(candles, breaks);
    expect(obs).toHaveLength(1);
    const ob = obs[0]!;
    expect(ob.kind).toBe('bull');
    expect(ob.obTime).toBe(t(3));
    expect(ob.startTime).toBe(t(5));
    expect(ob.minPrice).toBe(8.5);
    expect(ob.maxPrice).toBe(9.9);
    expect(ob.breakKind).toBe('BOS');
    expect(ob.unmitigated).toBe(true);
  });

  it('Bear OB: последняя bullish-свеча перед break↓', () => {
    // Swing-low на i=2 (low=8). Между i=2 и i=5 одна bullish свеча на i=3.
    const candles: Candle15m[] = [
      bar(t(0), 11, 12, 10, 10),
      bar(t(1), 10, 10.5, 9, 9),
      bar(t(2), 9, 9.5, 8, 8.5),       // swing-low (level=8)
      bar(t(3), 8.5, 9.5, 8.4, 9.4),   // bullish — кандидат на bear-OB
      bar(t(4), 9.4, 9.5, 8.5, 8.6),
      bar(t(5), 8.6, 8.7, 6.5, 7),     // break↓ (close=7 < 8)
      bar(t(6), 7, 7.5, 6, 6.5),
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'bos-d',
        kind: 'BOS',
        dir: 'down',
        level: 8,
        levelTime: t(2),
        breakTime: t(5),
        retestTime: null,
      },
    ];
    const obs = detectOrderBlocks(candles, breaks);
    expect(obs).toHaveLength(1);
    const ob = obs[0]!;
    expect(ob.kind).toBe('bear');
    expect(ob.obTime).toBe(t(3));
    expect(ob.startTime).toBe(t(5));
    expect(ob.minPrice).toBe(8.4);
    expect(ob.maxPrice).toBe(9.5);
    expect(ob.unmitigated).toBe(true);
  });

  it('hasFvg=true, если в импульсе есть 3-свечный разрыв', () => {
    // Импульс i=3..i=5 содержит FVG: i=3.high=9.9, i=5.low=10.0 — gap-up.
    const candles: Candle15m[] = [
      bar(t(0), 8, 9, 7, 9),
      bar(t(1), 9, 9.5, 8, 9.5),
      bar(t(2), 9.5, 10, 9, 9.8),
      bar(t(3), 9.8, 9.9, 8.5, 8.5),    // bearish — bull-OB
      bar(t(4), 8.6, 11, 8.6, 11),       // displacement
      bar(t(5), 11, 12, 10, 11.5),       // low=10 > prev.high=9.9 → bull-FVG между i=3 и i=5
      bar(t(6), 11.5, 13, 11, 12.5),
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'b',
        kind: 'BOS',
        dir: 'up',
        level: 10,
        levelTime: t(2),
        breakTime: t(5),
        retestTime: null,
      },
    ];
    const obs = detectOrderBlocks(candles, breaks);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.hasFvg).toBe(true);
  });

  it('Mitigation: если цена вернулась внутрь Bull OB, unmitigated=false', () => {
    const candles: Candle15m[] = [
      bar(t(0), 8, 9, 7, 9),
      bar(t(1), 9, 9.5, 8, 9.5),
      bar(t(2), 9.5, 10, 9, 9.8),
      bar(t(3), 9.8, 9.9, 8.5, 8.5),    // bull-OB (low=8.5, high=9.9)
      bar(t(4), 8.5, 9.5, 8.4, 9.5),
      bar(t(5), 9.5, 11.5, 9.4, 11),
      bar(t(6), 11, 11.5, 9.5, 10),     // low=9.5 ≤ 9.9 → mitigation
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'b',
        kind: 'BOS',
        dir: 'up',
        level: 10,
        levelTime: t(2),
        breakTime: t(5),
        retestTime: null,
      },
    ];
    const obs = detectOrderBlocks(candles, breaks);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.unmitigated).toBe(false);
    expect(obs[0]!.endTime).toBe(t(6));
  });

  it('requireFvg=true отбрасывает OB без gap-импульса', () => {
    // Тот же первый кейс — без gap'а в импульсе. Должен быть отброшен.
    const candles: Candle15m[] = [
      bar(t(0), 8, 9, 7, 9),
      bar(t(1), 9, 9.5, 8, 9.5),
      bar(t(2), 9.5, 10, 9, 9.8),
      bar(t(3), 9.8, 9.9, 8.5, 8.5),
      bar(t(4), 8.5, 9.5, 8.4, 9.5),
      bar(t(5), 9.5, 11.5, 9.4, 11),    // нет gap'а: low=9.4 ≤ prev.high=9.5
      bar(t(6), 11, 12, 10.5, 11.5),
    ];
    const breaks: StructureBreak[] = [
      {
        id: 'b',
        kind: 'BOS',
        dir: 'up',
        level: 10,
        levelTime: t(2),
        breakTime: t(5),
        retestTime: null,
      },
    ];
    const all = detectOrderBlocks(candles, breaks);
    const filtered = detectOrderBlocks(candles, breaks, { requireFvg: true });
    expect(all).toHaveLength(1);
    expect(all[0]!.hasFvg).toBe(false);
    expect(filtered).toHaveLength(0);
  });

  it('дедуп: одна и та же OB-свеча для нескольких подряд BOS не дублируется', () => {
    const candles: Candle15m[] = [
      bar(t(0), 8, 9, 7, 9),
      bar(t(1), 9, 9.5, 8, 9.5),
      bar(t(2), 9.5, 10, 9, 9.8),
      bar(t(3), 9.8, 9.9, 8.5, 8.5),
      bar(t(4), 8.5, 9.5, 8.4, 9.5),
      bar(t(5), 9.5, 11.5, 9.4, 11),
      bar(t(6), 11, 12, 10.5, 11.5),
    ];
    // Два разных swing-high → два BOS↑, но OB-свеча та же (i=3).
    const breaks: StructureBreak[] = [
      {
        id: 'b1', kind: 'BOS', dir: 'up',
        level: 10, levelTime: t(2), breakTime: t(5), retestTime: null,
      },
      {
        id: 'b2', kind: 'BOS', dir: 'up',
        level: 10.5, levelTime: t(2), breakTime: t(6), retestTime: null,
      },
    ];
    const obs = detectOrderBlocks(candles, breaks);
    expect(obs).toHaveLength(1);
  });
});
