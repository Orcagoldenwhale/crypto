import { describe, expect, it } from 'vitest';
import { hitTestCandle } from './hitTest';
import type { CanvasMetrics, Viewport } from './scale';
import type { Candle5m } from '@/types';

const M: CanvasMetrics = { width: 1000, height: 600, paddingRight: 0, paddingBottom: 0 };
const MS_5M = 5 * 60 * 1000;

function makeCandles(n: number, startTs = 0): Candle5m[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: startTs + i * MS_5M,
    open: 100,
    high: 105,
    low: 95,
    close: 103,
    volume: 100,
    delta: 0,
    vpoc_price: 100,
    max_vol: 50,
    delta_at_low: 0,
    delta_at_high: 0,
    clusters: [],
  }));
}

describe('hitTestCandle', () => {
  it('возвращает -1 на пустых данных', () => {
    const vp: Viewport = { timeStart: 0, timeEnd: 60_000, priceMin: 0, priceMax: 1 };
    expect(hitTestCandle([], 100, '5m', vp, M)).toBe(-1);
  });

  it('возвращает -1 если x вне canvas', () => {
    const cs = makeCandles(10);
    const vp: Viewport = { timeStart: 0, timeEnd: 10 * MS_5M, priceMin: 0, priceMax: 1 };
    expect(hitTestCandle(cs, -10, '5m', vp, M)).toBe(-1);
    expect(hitTestCandle(cs, M.width + 10, '5m', vp, M)).toBe(-1);
  });

  it('находит первую свечу при x=0', () => {
    const cs = makeCandles(10);
    const vp: Viewport = { timeStart: 0, timeEnd: 10 * MS_5M, priceMin: 0, priceMax: 1 };
    expect(hitTestCandle(cs, 0, '5m', vp, M)).toBe(0);
  });

  it('находит свечу №5 в её серединной точке', () => {
    const cs = makeCandles(10);
    const vp: Viewport = { timeStart: 0, timeEnd: 10 * MS_5M, priceMin: 0, priceMax: 1 };
    // Каждая свеча занимает 100px (1000/10). Свеча №5 — x ∈ [500, 600].
    expect(hitTestCandle(cs, 550, '5m', vp, M)).toBe(5);
  });

  it('возвращает -1 если курсор в "будущем" — после последней свечи', () => {
    const cs = makeCandles(5); // [0..5*MS_5M)
    // Viewport растянут на 10 свечей — половина пустая.
    const vp: Viewport = { timeStart: 0, timeEnd: 10 * MS_5M, priceMin: 0, priceMax: 1 };
    // x=900 → t=9*MS_5M, последняя свеча кончается в 5*MS_5M → пустое окно.
    expect(hitTestCandle(cs, 900, '5m', vp, M)).toBe(-1);
  });

  it('работает на 15m — duration 3× больше', () => {
    const MS_15M = 15 * 60 * 1000;
    const cs15: Candle5m[] = Array.from({ length: 4 }, (_, i) => ({
      timestamp: i * MS_15M,
      open: 100, high: 105, low: 95, close: 103,
      volume: 100, delta: 0, vpoc_price: 100, max_vol: 50,
      delta_at_low: 0, delta_at_high: 0, clusters: [],
    }));
    const vp: Viewport = { timeStart: 0, timeEnd: 4 * MS_15M, priceMin: 0, priceMax: 1 };
    expect(hitTestCandle(cs15, 0, '15m', vp, M)).toBe(0);
    expect(hitTestCandle(cs15, 750, '15m', vp, M)).toBe(3);
  });
});
