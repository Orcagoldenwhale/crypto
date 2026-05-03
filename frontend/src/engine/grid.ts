/**
 * Рендер фоновой сетки и осей цены/времени на canvas.
 */

import { chartHeight, chartWidth, priceToY, timeToX, yToPrice } from './scale';
import type { CanvasMetrics, Viewport } from './scale';

// ============================================================================
// Тема (синхронизировано с Tailwind @theme в src/index.css)
// ============================================================================

const COLORS = {
  bg: '#0a0e17',
  gridLine: 'rgba(255, 255, 255, 0.04)',
  axisBg: '#131722',
  axisLine: '#2a2e39',
  axisText: '#9ca3af',
} as const;

const FONT = '11px ui-monospace, SF Mono, Consolas, monospace';

// ============================================================================
// «Хорошие» шаги для тиков (axis ticks)
// ============================================================================

/**
 * Возвращает «красивый» шаг для оси, чтобы тиков было ~targetCount.
 * Шаги выбираются из множества {1, 2, 5} × 10^k.
 */
function niceStep(range: number, targetCount: number): number {
  if (range <= 0 || targetCount <= 0) return 1;
  const rough = range / targetCount;
  const exp = Math.floor(Math.log10(rough));
  const base = Math.pow(10, exp);
  const m = rough / base;
  let mult: number;
  if (m < 1.5) mult = 1;
  else if (m < 3) mult = 2;
  else if (m < 7) mult = 5;
  else mult = 10;
  return mult * base;
}

/** «Красивые» шаги времени в миллисекундах */
const TIME_STEPS_MS: readonly number[] = [
  60_000, // 1m
  5 * 60_000, // 5m
  15 * 60_000, // 15m
  30 * 60_000, // 30m
  60 * 60_000, // 1h
  3 * 60 * 60_000, // 3h
  6 * 60 * 60_000, // 6h
  12 * 60 * 60_000, // 12h
  24 * 60 * 60_000, // 1d
  3 * 24 * 60 * 60_000, // 3d
  7 * 24 * 60 * 60_000, // 1w
];

function niceTimeStep(range: number, targetCount: number): number {
  if (range <= 0 || targetCount <= 0) return TIME_STEPS_MS[0]!;
  const rough = range / targetCount;
  for (const step of TIME_STEPS_MS) {
    if (step >= rough) return step;
  }
  return TIME_STEPS_MS[TIME_STEPS_MS.length - 1]!;
}

// ============================================================================
// Форматирование подписей
// ============================================================================

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(0);
  if (price >= 10) return price.toFixed(2);
  return price.toFixed(4);
}

function formatTime(ts: number, stepMs: number): string {
  const d = new Date(ts);
  const utcH = d.getUTCHours().toString().padStart(2, '0');
  const utcM = d.getUTCMinutes().toString().padStart(2, '0');
  // Если шаг < 1 дня — показываем HH:MM
  if (stepMs < 24 * 60 * 60_000) return `${utcH}:${utcM}`;
  // Иначе DD MMM
  const day = d.getUTCDate().toString().padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getUTCMonth()] ?? '?';
  return `${day} ${month}`;
}

// ============================================================================
// Главная функция рендера
// ============================================================================

export interface GridRenderArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
}

export function renderGrid({ ctx, metrics, viewport }: GridRenderArgs): void {
  const cw = chartWidth(metrics);
  const ch = chartHeight(metrics);

  // Фон
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, metrics.width, metrics.height);

  // Линии цены (горизонтальные)
  const priceRange = viewport.priceMax - viewport.priceMin;
  const priceStep = niceStep(priceRange, 8);
  const priceStart = Math.ceil(viewport.priceMin / priceStep) * priceStep;

  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let p = priceStart; p <= viewport.priceMax; p += priceStep) {
    const y = Math.round(priceToY(p, viewport, metrics)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(cw, y);
  }
  ctx.stroke();

  // Линии времени (вертикальные)
  const timeRange = viewport.timeEnd - viewport.timeStart;
  const timeStep = niceTimeStep(timeRange, 8);
  const timeStart = Math.ceil(viewport.timeStart / timeStep) * timeStep;

  ctx.beginPath();
  for (let t = timeStart; t <= viewport.timeEnd; t += timeStep) {
    const x = Math.round(timeToX(t, viewport, metrics)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ch);
  }
  ctx.stroke();

  // === Ось цены справа ===
  ctx.fillStyle = COLORS.axisBg;
  ctx.fillRect(cw, 0, metrics.paddingRight, metrics.height);

  ctx.strokeStyle = COLORS.axisLine;
  ctx.beginPath();
  ctx.moveTo(cw + 0.5, 0);
  ctx.lineTo(cw + 0.5, ch);
  ctx.stroke();

  ctx.font = FONT;
  ctx.fillStyle = COLORS.axisText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let p = priceStart; p <= viewport.priceMax; p += priceStep) {
    const y = priceToY(p, viewport, metrics);
    if (y < 8 || y > ch - 8) continue;
    ctx.fillText(formatPrice(p), cw + 6, y);
  }

  // === Ось времени снизу ===
  ctx.fillStyle = COLORS.axisBg;
  ctx.fillRect(0, ch, metrics.width, metrics.paddingBottom);

  ctx.strokeStyle = COLORS.axisLine;
  ctx.beginPath();
  ctx.moveTo(0, ch + 0.5);
  ctx.lineTo(metrics.width, ch + 0.5);
  ctx.stroke();

  ctx.fillStyle = COLORS.axisText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let t = timeStart; t <= viewport.timeEnd; t += timeStep) {
    const x = timeToX(t, viewport, metrics);
    if (x < 24 || x > cw - 24) continue;
    ctx.fillText(formatTime(t, timeStep), x, ch + metrics.paddingBottom / 2);
  }
}

// ============================================================================
// Подпись цены/времени для перекрестия (badge на оси)
// ============================================================================

export interface CrosshairAxisLabelsArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  cursorX: number;
  cursorY: number;
}

export function renderCrosshairAxisLabels({
  ctx,
  metrics,
  viewport,
  cursorX,
  cursorY,
}: CrosshairAxisLabelsArgs): void {
  const cw = chartWidth(metrics);
  const ch = chartHeight(metrics);

  // Цена (badge на правой оси)
  if (cursorY >= 0 && cursorY <= ch) {
    const price = yToPrice(cursorY, viewport, metrics);
    const label = formatPrice(price);
    ctx.font = FONT;
    const w = ctx.measureText(label).width + 10;
    const h = 16;
    const y = Math.max(h / 2, Math.min(ch - h / 2, cursorY));
    ctx.fillStyle = '#363a45';
    ctx.fillRect(cw, y - h / 2, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cw + 5, y);
  }

  // Время (badge на нижней оси)
  if (cursorX >= 0 && cursorX <= cw) {
    const time = (viewport.timeStart + (cursorX / cw) * (viewport.timeEnd - viewport.timeStart));
    const stepMs = niceTimeStep(viewport.timeEnd - viewport.timeStart, 8);
    const label = formatTime(time, stepMs);
    ctx.font = FONT;
    const w = ctx.measureText(label).width + 10;
    const h = 16;
    const x = Math.max(w / 2, Math.min(cw - w / 2, cursorX));
    ctx.fillStyle = '#363a45';
    ctx.fillRect(x - w / 2, ch, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, ch + h / 2);
  }
}
