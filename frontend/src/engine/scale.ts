/**
 * Чистые функции масштабирования между мировыми и экранными координатами.
 *
 * Мировые координаты: (timestamp в ms, price)
 * Экранные:           (x, y) в CSS-пикселях относительно canvas
 *
 * Все функции стабильны при viewport.range = 0 (возвращают 0 / center).
 * Это упрощает edge cases при инициализации и пустых данных.
 */

import type { TimestampMs, Price } from '@/types';

// ============================================================================
// Типы
// ============================================================================

export interface Viewport {
  /** Левая граница времени (ms) */
  timeStart: TimestampMs;
  /** Правая граница времени (ms, эксклюзивно) */
  timeEnd: TimestampMs;
  /** Минимальная цена в видимой области */
  priceMin: Price;
  /** Максимальная цена в видимой области */
  priceMax: Price;
}

export interface CanvasMetrics {
  /** Ширина canvas в CSS-пикселях */
  width: number;
  /** Высота canvas в CSS-пикселях */
  height: number;
  /** Отступ справа под ось цены */
  paddingRight: number;
  /** Отступ снизу под ось времени */
  paddingBottom: number;
}

// ============================================================================
// Размеры графической области (без осей)
// ============================================================================

export function chartWidth(metrics: CanvasMetrics): number {
  return Math.max(0, metrics.width - metrics.paddingRight);
}

export function chartHeight(metrics: CanvasMetrics): number {
  return Math.max(0, metrics.height - metrics.paddingBottom);
}

// ============================================================================
// Время ↔ X
// ============================================================================

export function timeToX(time: TimestampMs, vp: Viewport, metrics: CanvasMetrics): number {
  const range = vp.timeEnd - vp.timeStart;
  if (range <= 0) return 0;
  const w = chartWidth(metrics);
  return ((time - vp.timeStart) / range) * w;
}

export function xToTime(x: number, vp: Viewport, metrics: CanvasMetrics): TimestampMs {
  const range = vp.timeEnd - vp.timeStart;
  if (range <= 0) return vp.timeStart;
  const w = chartWidth(metrics);
  if (w <= 0) return vp.timeStart;
  return vp.timeStart + (x / w) * range;
}

// ============================================================================
// Цена ↔ Y
// ============================================================================

export function priceToY(price: Price, vp: Viewport, metrics: CanvasMetrics): number {
  const range = vp.priceMax - vp.priceMin;
  if (range <= 0) return chartHeight(metrics) / 2;
  const h = chartHeight(metrics);
  return h - ((price - vp.priceMin) / range) * h;
}

export function yToPrice(y: number, vp: Viewport, metrics: CanvasMetrics): Price {
  const range = vp.priceMax - vp.priceMin;
  if (range <= 0) return vp.priceMin;
  const h = chartHeight(metrics);
  if (h <= 0) return vp.priceMin;
  return vp.priceMin + ((h - y) / h) * range;
}

// ============================================================================
// Ширина одной свечи в пикселях
// ============================================================================

const MS_5M = 5 * 60 * 1000;
const MS_15M = 15 * 60 * 1000;
const MS_1H = 60 * 60 * 1000;

export function candleDurationMs(timeframe: '1h' | '15m' | '5m'): number {
  if (timeframe === '1h') return MS_1H;
  return timeframe === '15m' ? MS_15M : MS_5M;
}

export function candleWidthPx(
  timeframe: '1h' | '15m' | '5m',
  vp: Viewport,
  metrics: CanvasMetrics,
): number {
  const range = vp.timeEnd - vp.timeStart;
  if (range <= 0) return 0;
  const w = chartWidth(metrics);
  return (candleDurationMs(timeframe) / range) * w;
}

// ============================================================================
// Поиск видимого диапазона свечей (бинарный поиск)
// ============================================================================

interface HasTimestamp {
  timestamp: TimestampMs;
}

/**
 * Возвращает [startIdx, endIdx] (включительно) свечей,
 * чьи timestamps пересекаются с [timeStart, timeEnd].
 *
 * Возвращает [-1, -1] если данных нет или диапазон не пересекает их.
 *
 * Расширяет найденный диапазон на 1 свечу в каждую сторону, чтобы
 * частично видимые свечи на границах не мерцали.
 *
 * Сложность: O(log n).
 */
export function findVisibleRange<T extends HasTimestamp>(
  candles: readonly T[],
  timeStart: TimestampMs,
  timeEnd: TimestampMs,
): [number, number] {
  const n = candles.length;
  if (n === 0) return [-1, -1];

  // lower_bound: первый индекс, где timestamp >= timeStart
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const c = candles[mid];
    if (c && c.timestamp < timeStart) lo = mid + 1;
    else hi = mid;
  }
  const firstFromStart = lo;

  // upper_bound: первый индекс, где timestamp > timeEnd
  lo = 0;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const c = candles[mid];
    if (c && c.timestamp <= timeEnd) lo = mid + 1;
    else hi = mid;
  }
  const lastBeforeEnd = lo - 1;

  if (lastBeforeEnd < 0 || firstFromStart >= n) return [-1, -1];
  if (firstFromStart > lastBeforeEnd) return [-1, -1];

  // Расширяем на 1 свечу в каждую сторону для плавности на границах.
  const startIdx = Math.max(0, firstFromStart - 1);
  const endIdx = Math.min(n - 1, lastBeforeEnd + 1);
  return [startIdx, endIdx];
}

// ============================================================================
// Авто-подгонка ценового диапазона под видимые свечи
// ============================================================================

interface HasOhlc {
  high: Price;
  low: Price;
}

/**
 * Считает minPrice/maxPrice по видимым свечам с заданным процентом отступа.
 * paddingFraction = 0.05 → 5% сверху и снизу.
 */
export function fitPriceRange<T extends HasOhlc>(
  candles: readonly T[],
  startIdx: number,
  endIdx: number,
  paddingFraction = 0.05,
): { priceMin: Price; priceMax: Price } {
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx || candles.length === 0) {
    return { priceMin: 0, priceMax: 1 };
  }

  let min = Infinity;
  let max = -Infinity;
  const last = Math.min(endIdx, candles.length - 1);
  for (let i = Math.max(0, startIdx); i <= last; i++) {
    const c = candles[i];
    if (!c) continue;
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { priceMin: 0, priceMax: 1 };
  }

  const range = max - min;
  // Если диапазон вырожден (все свечи на одной цене) — добавим небольшой пэддинг.
  const padding = range > 0 ? range * paddingFraction : Math.max(1, max * 0.001);
  return { priceMin: min - padding, priceMax: max + padding };
}
