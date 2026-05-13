import { describe, it, expect } from 'vitest';
import { alignTrimForHtf } from './extendedTrim';
import type { Candle5m } from '@/types';

const MS_5M = 5 * 60 * 1000;

/** UTC-полночь 2026-01-01 (произвольная точка, важна только кратность). */
const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Генерирует N последовательных 5m свечей с UTC-полуночи. */
function makeRaw(n: number): Candle5m[] {
  const out: Candle5m[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      timestamp: T0 + i * MS_5M,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
      delta: 0,
      vpoc_price: 100,
      max_vol: 1,
      delta_at_low: 0,
      delta_at_high: 0,
      clusters: [],
    });
  }
  return out;
}

describe('alignTrimForHtf', () => {
  it('5m HTF (single) — нет выравнивания, точно candleCount', () => {
    const raw = makeRaw(10080);
    const out = alignTrimForHtf(raw, 10000, '5m');
    expect(out.length).toBe(10000);
    expect(out[0]!.timestamp).toBe(T0 + 80 * MS_5M);
  });

  it('15m HTF — первая свеча кратна 15m UTC', () => {
    const raw = makeRaw(10080);
    const out = alignTrimForHtf(raw, 10000, '15m');
    // 10080 - 10000 = 80, округляем ВВЕРХ до 81 (ближайший кратный 3)
    // → ожидаем 10080 - 81 = 9999 свечей.
    expect(out.length).toBe(9999);
    // Первая свеча должна быть на 15m-границе.
    const firstTs = out[0]!.timestamp;
    expect((firstTs - T0) % (15 * 60 * 1000)).toBe(0);
    expect(firstTs).toBe(T0 + 81 * MS_5M); // 6:45 UTC
  });

  it('1h HTF — первая свеча кратна 1h UTC', () => {
    const raw = makeRaw(10080);
    const out = alignTrimForHtf(raw, 10000, '1h');
    // 80 округляем вверх до 84 (кратное 12).
    expect(out.length).toBe(10080 - 84);
    const firstTs = out[0]!.timestamp;
    expect((firstTs - T0) % (60 * 60 * 1000)).toBe(0);
    expect(firstTs).toBe(T0 + 84 * MS_5M); // 7:00 UTC
  });

  it('candleCount ≥ длины raw — возвращает весь raw без изменений', () => {
    const raw = makeRaw(100);
    expect(alignTrimForHtf(raw, 200, '15m')).toEqual(raw);
    expect(alignTrimForHtf(raw, 100, '1h')).toEqual(raw);
  });

  it('пустой массив — возвращает пустой', () => {
    const raw: Candle5m[] = [];
    expect(alignTrimForHtf(raw, 1000, '15m')).toEqual([]);
  });

  it('уже выровненный край — без потерь свечей', () => {
    const raw = makeRaw(10000); // ровно 10000
    // candleCount = 9999 → drop = 1 → round до 3 → drop = 3 → 9997 свечей
    const out = alignTrimForHtf(raw, 9999, '15m');
    expect(out.length).toBe(9997);
    expect((out[0]!.timestamp - T0) % (15 * 60 * 1000)).toBe(0);
  });

  it('candleCount = raw.length — drop=0, никаких изменений', () => {
    const raw = makeRaw(10080);
    const out = alignTrimForHtf(raw, 10080, '1h');
    expect(out.length).toBe(10080);
    expect(out[0]!.timestamp).toBe(T0); // первая исходная
  });

  it('первая свеча в 1h HTF — следующий ровный час, ни секундой раньше', () => {
    // Скажем нужно отбросить 13 свечей (не кратно 12, кратное 12 = 24).
    // Получим 24 drop, первая на T0 + 24*5m = T0 + 2h.
    const raw = makeRaw(10000);
    const out = alignTrimForHtf(raw, 10000 - 13, '1h');
    expect(out[0]!.timestamp).toBe(T0 + 24 * MS_5M);
  });
});
