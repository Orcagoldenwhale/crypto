import { describe, it, expect } from 'vitest';
import { detectPrevDayLevels } from './detectPrevDayLevels';
import type { Candle1h } from '@/types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const D1 = Date.UTC(2026, 0, 1); // 2026-01-01
const D2 = D1 + DAY;
const D3 = D2 + DAY;

function c(ts: number, h: number, l: number): Candle1h {
  return { timestamp: ts, open: 100, high: h, low: l, close: 100, volume: 0 };
}

describe('detectPrevDayLevels', () => {
  it('пусто при одной свече', () => {
    expect(detectPrevDayLevels([c(D1, 110, 90)])).toEqual([]);
  });

  it('пусто если данные только в одном дне', () => {
    const candles: Candle1h[] = [
      c(D1, 110, 90),
      c(D1 + HOUR, 108, 92),
      c(D1 + 5 * HOUR, 112, 88),
    ];
    expect(detectPrevDayLevels(candles)).toEqual([]);
  });

  it('PDH/PDL для двух дней', () => {
    // День 1 (01.01): high=120, low=80.
    // День 2 (02.01): свечи в диапазоне 100..105 — НЕ пересекают уровни.
    const candles: Candle1h[] = [
      c(D1, 110, 100),
      c(D1 + HOUR, 120, 80), // high=120, low=80 за день
      c(D1 + 5 * HOUR, 115, 95),
      c(D2, 102, 100),
      c(D2 + HOUR, 105, 100),
      c(D2 + 5 * HOUR, 104, 101),
    ];
    const result = detectPrevDayLevels(candles);
    expect(result).toHaveLength(2);
    const pdh = result.find((p) => p.kind === 'high')!;
    const pdl = result.find((p) => p.kind === 'low')!;
    expect(pdh.price).toBe(120);
    expect(pdl.price).toBe(80);
    expect(pdh.startTime).toBe(D2);
    expect(pdh.unmitigated).toBe(true);
    expect(pdl.unmitigated).toBe(true);
    expect(pdh.sourceDate).toBe('2026-01-01');
  });

  it('PDH помечается mitigated после пересечения', () => {
    // День 1: high=120. День 2: свеча с high=125 — пересекла PDH.
    const candles: Candle1h[] = [
      c(D1, 110, 100),
      c(D1 + HOUR, 120, 80),
      c(D2, 100, 95),
      c(D2 + 2 * HOUR, 125, 100), // пересекает PDH=120
    ];
    const result = detectPrevDayLevels(candles);
    const pdh = result.find((p) => p.kind === 'high')!;
    expect(pdh.unmitigated).toBe(false);
    expect(pdh.endTime).toBe(D2 + 2 * HOUR);
  });

  it('последний день не выпускает PDH/PDL (он ещё формируется)', () => {
    // 3 дня. PDH/PDL ожидаем только за дни 1 и 2 (4 уровня).
    const candles: Candle1h[] = [
      c(D1, 110, 90),
      c(D2, 105, 85),
      c(D3, 100, 80),
    ];
    const result = detectPrevDayLevels(candles);
    expect(result).toHaveLength(4); // 2 дня × (high+low)
    const dates = new Set(result.map((r) => r.sourceDate));
    expect(dates.size).toBe(2);
    expect(dates.has('2026-01-03')).toBe(false);
  });
});
