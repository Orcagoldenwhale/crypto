import { describe, it, expect } from 'vitest';
import { detectRejectionBlocks } from './detectRejectionBlocks';
import type { Candle15m } from '@/types';
import type { LiquidityZone } from './types';

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

describe('detectRejectionBlocks', () => {
  it('пусто при отсутствии длинных фитилей', () => {
    // body=1 (100..101), фитили по 0.1 — < wickRatio*body
    const candles: Candle15m[] = [
      bar(t(0), 100, 101.1, 99.9, 101),
      bar(t(1), 101, 102.1, 100.9, 102),
    ];
    expect(detectRejectionBlocks(candles, [], { requireSweep: false })).toEqual([]);
  });

  it('bull RB: длинный нижний фитиль, requireSweep=false', () => {
    // open=100, close=100.2 (тело 0.2), low=98 (нижний фитиль 2.0).
    // Отношение фитиля/тело = 10, при wickRatio=2 — проходит.
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),
      bar(t(1), 100.2, 101, 100, 100.5),
    ];
    const result = detectRejectionBlocks(candles, [], { requireSweep: false });
    expect(result).toHaveLength(1);
    const rb = result[0]!;
    expect(rb.kind).toBe('bull');
    expect(rb.minPrice).toBe(98);
    expect(rb.maxPrice).toBe(100); // min(open=100, close=100.2)
    expect(rb.mtPrice).toBe(99); // (98 + 100) / 2
    expect(rb.hasSweep).toBe(false);
  });

  it('bear RB: длинный верхний фитиль', () => {
    // open=100, close=99.8 (тело 0.2), high=102 (верхний фитиль 2.0).
    const candles: Candle15m[] = [
      bar(t(0), 100, 102, 99.7, 99.8),
      bar(t(1), 99.8, 100, 99, 99.5), // body=0.3, upper=0.2, lower=0.5 — не RB
    ];
    const result = detectRejectionBlocks(candles, [], { requireSweep: false });
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('bear');
    expect(result[0]!.maxPrice).toBe(102);
    expect(result[0]!.minPrice).toBe(100); // max(open=100, close=99.8) = 100
  });

  it('requireSweep=true: без пробитой ликвидности RB не выдаётся', () => {
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),
      bar(t(1), 100.2, 101, 100, 100.5),
    ];
    expect(detectRejectionBlocks(candles, [], { requireSweep: true })).toEqual([]);
  });

  it('requireSweep=true: RB валидируется при пробое swing-low фитилём', () => {
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),
      bar(t(1), 100.2, 101, 100, 100.5),
    ];
    const liq: LiquidityZone[] = [
      {
        id: 'low-99',
        kind: 'low',
        price: 99,
        startTime: T0 - M15 * 10,
        endTime: T0,
        touches: 2,
        sweep: null,
      },
    ];
    const result = detectRejectionBlocks(candles, liq, { requireSweep: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.hasSweep).toBe(true);
  });

  it('mitigation: следующая свеча зашла в фитиль', () => {
    // RB на t(0). t(1) высокая, t(2) — заходит в зону (low=99 ≤ maxPrice=100).
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),
      bar(t(1), 100.2, 102, 101, 101.5),
      bar(t(2), 101, 101.5, 99, 99.5),
    ];
    const result = detectRejectionBlocks(candles, [], { requireSweep: false });
    expect(result).toHaveLength(1);
    expect(result[0]!.unmitigated).toBe(false);
    expect(result[0]!.endTime).toBe(t(2));
  });

  it('useMeanThreshold: mitigation только при закрытии тела за MT', () => {
    // Bull RB t(0): фитиль 98..100 (тело 100..100.2), MT=99.
    // t(1) low=99.5 — фитилём задевает зону, но НЕ MT. Без MT — mitigated;
    // с MT — должен остаться unmitigated.
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),
      bar(t(1), 100.2, 100.5, 99.5, 100),
    ];
    const noMt = detectRejectionBlocks(candles, [], { requireSweep: false });
    expect(noMt[0]!.unmitigated).toBe(false); // фитиль зашёл в зону → mitigated

    const withMt = detectRejectionBlocks(candles, [], {
      requireSweep: false,
      useMeanThreshold: true,
    });
    expect(withMt[0]!.unmitigated).toBe(true); // close=100 > MT=99 → не пробит
  });

  it('mtIncludeWicks: фитиль за MT тоже триггерит mitigation', () => {
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),    // MT = (98+100)/2 = 99
      bar(t(1), 100.2, 100.5, 98.5, 100),  // low=98.5 < MT=99, но close=100
    ];
    const closeOnly = detectRejectionBlocks(candles, [], {
      requireSweep: false,
      useMeanThreshold: true,
      mtIncludeWicks: false,
    });
    expect(closeOnly[0]!.unmitigated).toBe(true);

    const withWicks = detectRejectionBlocks(candles, [], {
      requireSweep: false,
      useMeanThreshold: true,
      mtIncludeWicks: true,
    });
    expect(withWicks[0]!.unmitigated).toBe(false); // low пробил MT
  });

  it('alsoAtFvg: RB валиден если фитиль зашёл в FVG (без sweep ликвидности)', () => {
    // RB-свеча с длинным нижним фитилём, НЕ снимающим ликвидность,
    // но заходящим в bull-FVG, сформированный ранее.
    const candles: Candle15m[] = [
      bar(t(0), 100, 100.3, 98, 100.2),    // wick down 98..100
      bar(t(1), 100.2, 101, 100, 100.5),
    ];
    // Без sweep и без FVG-контекста — пусто.
    expect(
      detectRejectionBlocks(candles, [], { requireSweep: true }),
    ).toEqual([]);

    // FVG зона [97..99] — фитиль свечи (98..100) её пересекает.
    const fvgs = [{
      id: 'fvg1',
      kind: 'bull' as const,
      startTime: T0 - M15 * 5,
      endTime: T0,
      minPrice: 97,
      maxPrice: 99,
      unmitigated: true,
    }];
    const result = detectRejectionBlocks(candles, [], {
      requireSweep: true,
      alsoAtFvg: true,
      fvgZones: fvgs,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('bull');
  });
});
