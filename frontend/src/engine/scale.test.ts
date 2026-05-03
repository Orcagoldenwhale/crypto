import { describe, it, expect } from 'vitest';
import {
  timeToX,
  xToTime,
  priceToY,
  yToPrice,
  candleWidthPx,
  candleDurationMs,
  findVisibleRange,
  fitPriceRange,
  type Viewport,
  type CanvasMetrics,
} from './scale';

const VP: Viewport = {
  timeStart: 1_000_000,
  timeEnd: 2_000_000,
  priceMin: 100,
  priceMax: 200,
};

const METRICS: CanvasMetrics = {
  width: 1000,
  height: 600,
  paddingRight: 60,
  paddingBottom: 24,
};
// chartWidth = 940, chartHeight = 576

describe('timeToX / xToTime', () => {
  it('левая граница времени → x = 0', () => {
    expect(timeToX(1_000_000, VP, METRICS)).toBeCloseTo(0);
  });

  it('правая граница времени → x = chartWidth', () => {
    expect(timeToX(2_000_000, VP, METRICS)).toBeCloseTo(940);
  });

  it('середина времени → x = chartWidth / 2', () => {
    expect(timeToX(1_500_000, VP, METRICS)).toBeCloseTo(470);
  });

  it('обратное преобразование (timeToX → xToTime) = identity', () => {
    for (const t of [1_000_000, 1_250_000, 1_700_000, 2_000_000]) {
      const x = timeToX(t, VP, METRICS);
      const back = xToTime(x, VP, METRICS);
      expect(back).toBeCloseTo(t);
    }
  });

  it('range = 0 не падает', () => {
    const vp: Viewport = { ...VP, timeStart: 100, timeEnd: 100 };
    expect(timeToX(100, vp, METRICS)).toBe(0);
    expect(xToTime(50, vp, METRICS)).toBe(100);
  });
});

describe('priceToY / yToPrice', () => {
  it('priceMax → y = 0 (верх экрана)', () => {
    expect(priceToY(200, VP, METRICS)).toBeCloseTo(0);
  });

  it('priceMin → y = chartHeight (низ)', () => {
    expect(priceToY(100, VP, METRICS)).toBeCloseTo(576);
  });

  it('середина цены → y = chartHeight / 2', () => {
    expect(priceToY(150, VP, METRICS)).toBeCloseTo(288);
  });

  it('обратное преобразование = identity', () => {
    for (const p of [100, 125, 175, 200]) {
      const y = priceToY(p, VP, METRICS);
      const back = yToPrice(y, VP, METRICS);
      expect(back).toBeCloseTo(p);
    }
  });

  it('range = 0 не падает (priceMin == priceMax)', () => {
    const vp: Viewport = { ...VP, priceMin: 100, priceMax: 100 };
    expect(priceToY(100, vp, METRICS)).toBeCloseTo(288);
    expect(yToPrice(0, vp, METRICS)).toBe(100);
  });
});

describe('candleWidthPx', () => {
  it('15m тайм-фрейм считает корректно', () => {
    const vp: Viewport = { ...VP, timeStart: 0, timeEnd: 30 * 60 * 1000 };
    // 30 минут видно, 15m свеча = половина → ровно chartWidth/2
    expect(candleWidthPx('15m', vp, METRICS)).toBeCloseTo(470);
  });

  it('5m в три раза тоньше 15m', () => {
    const vp: Viewport = { ...VP, timeStart: 0, timeEnd: 60 * 60 * 1000 };
    const w15 = candleWidthPx('15m', vp, METRICS);
    const w5 = candleWidthPx('5m', vp, METRICS);
    expect(w15 / w5).toBeCloseTo(3);
  });

  it('candleDurationMs возвращает правильные значения', () => {
    expect(candleDurationMs('1h')).toBe(60 * 60 * 1000);
    expect(candleDurationMs('15m')).toBe(15 * 60 * 1000);
    expect(candleDurationMs('5m')).toBe(5 * 60 * 1000);
  });
});

describe('findVisibleRange', () => {
  const candles = Array.from({ length: 10 }, (_, i) => ({ timestamp: i * 100 }));
  // timestamps: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900]

  it('пустой массив → [-1, -1]', () => {
    expect(findVisibleRange([], 0, 1000)).toEqual([-1, -1]);
  });

  it('диапазон полностью внутри данных (расширяется на 1 в каждую сторону)', () => {
    const [start, end] = findVisibleRange(candles, 250, 550);
    // timestamps в [250, 550]: 300 (i=3), 400 (i=4), 500 (i=5)
    // расширение слева: max(0, 3-1) = 2 → захватывает 200
    // расширение справа: min(9, 5+1) = 6 → захватывает 600
    expect(start).toBe(2);
    expect(end).toBe(6);
  });

  it('диапазон от начала', () => {
    const [start, end] = findVisibleRange(candles, 0, 200);
    expect(start).toBe(0);
    expect(end).toBeGreaterThanOrEqual(2);
  });

  it('диапазон до конца', () => {
    const [start, end] = findVisibleRange(candles, 700, 1000);
    expect(end).toBe(9);
    expect(start).toBeLessThanOrEqual(7);
  });

  it('диапазон полностью левее данных → [-1, -1]', () => {
    expect(findVisibleRange(candles, -500, -100)).toEqual([-1, -1]);
  });

  it('диапазон полностью правее данных → [-1, -1]', () => {
    expect(findVisibleRange(candles, 10_000, 20_000)).toEqual([-1, -1]);
  });

  it('большой массив (100k свечей) — бинарный поиск работает быстро', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => ({ timestamp: i }));
    const t0 = performance.now();
    const result = findVisibleRange(big, 50_000, 50_010);
    const t1 = performance.now();
    expect(result[0]).toBeLessThanOrEqual(50_000);
    expect(result[1]).toBeGreaterThanOrEqual(50_010);
    expect(t1 - t0).toBeLessThan(5);
  });
});

describe('fitPriceRange', () => {
  const candles = [
    { high: 110, low: 90 },
    { high: 120, low: 80 },
    { high: 130, low: 100 },
  ];

  it('считает min/low и max/high по диапазону', () => {
    const { priceMin, priceMax } = fitPriceRange(candles, 0, 2, 0);
    expect(priceMin).toBe(80);
    expect(priceMax).toBe(130);
  });

  it('добавляет процентный padding', () => {
    const { priceMin, priceMax } = fitPriceRange(candles, 0, 2, 0.1);
    // range = 50, padding = 5
    expect(priceMin).toBe(75);
    expect(priceMax).toBe(135);
  });

  it('пустой/невалидный диапазон → дефолт', () => {
    expect(fitPriceRange([], 0, 0)).toEqual({ priceMin: 0, priceMax: 1 });
    expect(fitPriceRange(candles, -1, -1)).toEqual({ priceMin: 0, priceMax: 1 });
    expect(fitPriceRange(candles, 5, 10)).toEqual({ priceMin: 0, priceMax: 1 });
  });

  it('вырожденный диапазон (все свечи на одной цене) даёт ненулевой padding', () => {
    const flat = [
      { high: 100, low: 100 },
      { high: 100, low: 100 },
    ];
    const { priceMin, priceMax } = fitPriceRange(flat, 0, 1);
    expect(priceMin).toBeLessThan(priceMax);
  });
});
