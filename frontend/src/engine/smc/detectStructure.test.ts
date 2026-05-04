import { describe, expect, it } from 'vitest';
import { detectStructure } from './detectStructure';
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

/**
 * Помощник: «обычная» свеча шириной [low..high] вокруг close. open=close для
 * упрощения — нам важен только close для проверки break-условий и
 * high/low для swing-detection и retest.
 */
function bar(i: number, high: number, low: number, close: number): Candle15m {
  return c(t(i), close, high, low, close);
}

describe('detectStructure', () => {
  const opts = { lookback: 2 };

  it('возвращает пусто, если данных мало', () => {
    expect(detectStructure([], opts)).toEqual([]);
    expect(detectStructure([bar(0, 1, 0, 1)], opts)).toEqual([]);
  });

  it('детектирует BOS↑ при пробое предыдущего HH в восходящем тренде', () => {
    // Серия: пик A (high=10), долина (low=8), пик B выше A → BOS↑.
    // Между A и B должна быть свеча с close > 10 — она и есть break-свеча.
    // С lookback=2: нужно по 2 свечи слева/справа от каждого swing-point.
    //
    // i:   0    1    2    3    4    5    6    7    8
    // hi:  9    9.5  10   9    8.5  9    11   10.5 10
    // lo:  7    7.5  8    7.5  6    7    9    8    7.5
    // cl:  8    9    10   8.5  7    8    11   10   9
    const candles: Candle15m[] = [
      bar(0, 9, 7, 8),
      bar(1, 9.5, 7.5, 9),
      bar(2, 10, 8, 10),     // swing-high A на 10
      bar(3, 9, 7.5, 8.5),
      bar(4, 8.5, 6, 7),     // swing-low на 6
      bar(5, 9, 7, 8),
      bar(6, 11, 9, 11),     // close=11 > 10 — break↑
      bar(7, 10.5, 8, 10),
      bar(8, 10, 7.5, 9),
    ];
    const breaks = detectStructure(candles, opts);
    expect(breaks).toHaveLength(1);
    const b = breaks[0]!;
    expect(b.kind).toBe('BOS');
    expect(b.dir).toBe('up');
    expect(b.level).toBe(10);
    expect(b.levelTime).toBe(t(2));
    expect(b.breakTime).toBe(t(6));
  });

  it('детектирует CHoCH↓ при пробое последнего HL в восходящем тренде', () => {
    // Сначала BOS↑ (тренд up подтверждён), потом close < последнего swing-low → CHoCH↓.
    // Уровень break↓ должен быть последним swing-low на момент break.
    //
    // i:    0   1    2    3    4    5    6    7    8    9    10   11
    // hi:   9   9.5  10   9    8.5  9    11   10.5 10   9.5  9    8
    // lo:   7   7.5  8    7.5  6    7    9    8    7.5  7    6.5  4
    // cl:   8   9    10   8.5  7    8    11   10   9    8    7    4.5
    const candles: Candle15m[] = [
      bar(0, 9, 7, 8),
      bar(1, 9.5, 7.5, 9),
      bar(2, 10, 8, 10),     // swing-high #1
      bar(3, 9, 7.5, 8.5),
      bar(4, 8.5, 6, 7),     // swing-low #1 — потенциальный HL
      bar(5, 9, 7, 8),
      bar(6, 11, 9, 11),     // BOS↑
      bar(7, 10.5, 8, 10),
      bar(8, 10, 7.5, 9),    // swing-high #2 — после lookback=2 защитит уровень 11 не подтверждается до i+lookback=10
      bar(9, 9.5, 7, 8),
      bar(10, 9, 6.5, 7),
      bar(11, 8, 4, 4.5),    // close=4.5 < last swing-low (6) — break↓
    ];
    const breaks = detectStructure(candles, opts);
    expect(breaks).toHaveLength(2);
    const [bos, choch] = breaks;
    expect(bos!.kind).toBe('BOS');
    expect(bos!.dir).toBe('up');
    expect(choch!.kind).toBe('CHoCH');
    expect(choch!.dir).toBe('down');
    expect(choch!.level).toBe(6);
    expect(choch!.breakTime).toBe(t(11));
  });

  it('фиксирует retest, когда цена возвращается к сломанному уровню', () => {
    // BOS↑ на уровне 10 break-свечой close=11; после неё свеча с low ≤ 10 — retest.
    const candles: Candle15m[] = [
      bar(0, 9, 7, 8),
      bar(1, 9.5, 7.5, 9),
      bar(2, 10, 8, 10),     // swing-high A на 10
      bar(3, 9, 7.5, 8.5),
      bar(4, 8.5, 6, 7),
      bar(5, 9, 7, 8),
      bar(6, 11, 9, 11),     // break↑
      bar(7, 10.5, 8, 10),
      bar(8, 11, 9.5, 10.5), // low=9.5 ≤ 10 — это retest
      bar(9, 10.5, 9, 9.5),
      bar(10, 10, 8.5, 9),
    ];
    const breaks = detectStructure(candles, opts);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.retestTime).toBe(t(7));
  });

  it('retest = null, если цена ни разу не вернулась после break', () => {
    const candles: Candle15m[] = [
      bar(0, 9, 7, 8),
      bar(1, 9.5, 7.5, 9),
      bar(2, 10, 8, 10),
      bar(3, 9, 7.5, 8.5),
      bar(4, 8.5, 6, 7),
      bar(5, 9, 7, 8),
      bar(6, 12, 11, 12),    // break↑, после этого low всегда > 10
      bar(7, 13, 11.5, 13),
      bar(8, 14, 12, 14),
      bar(9, 15, 13, 15),
    ];
    const breaks = detectStructure(candles, opts);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.retestTime).toBeNull();
  });

  it('игнорирует low/high внутри той же свечи, что и swing — break только на следующих свечах', () => {
    // Свеча, формирующая swing-high одновременно close < open, не должна сразу
    // же ломать сама себя.
    const candles: Candle15m[] = [
      bar(0, 9, 7, 8),
      bar(1, 9.5, 7.5, 9),
      bar(2, 10, 8, 10),
      bar(3, 9, 7.5, 8.5),
      bar(4, 8.5, 6, 7),     // swing-low
      bar(5, 9, 7, 8),
      bar(6, 9.5, 7.5, 9),
    ];
    const breaks = detectStructure(candles, opts);
    expect(breaks).toEqual([]);
  });
});
