/**
 * Рендер SMC-оверлея: FVG (прямоугольники) и Liquidity (горизонтальные линии).
 *
 * Стилистика:
 *   - bull-FVG  — мягко-зелёная заливка с ярко-зелёной кромкой;
 *   - bear-FVG  — мягко-красная заливка с ярко-красной кромкой;
 *   - закрытый FVG (mitigated) — тусклая заливка, штриховая граница;
 *   - liquidity-high — пунктирная линия алого оттенка с "✕" если sweep;
 *   - liquidity-low  — пунктирная линия бирюзового оттенка с "✕" если sweep.
 *
 * Все цвета подобраны так, чтобы поверх POI-зон и свечей оставаться читаемыми.
 */

import { priceToY, timeToX } from '../scale';
import type { CanvasMetrics, Viewport } from '../scale';
import type { FvgZone, LiquidityZone, SmcOverlay } from './types';

// ============================================================================
// Цвета
// ============================================================================

const COLORS = {
  bullFill: 'rgba(34, 197, 94, 0.10)', // emerald-500
  bullStroke: 'rgba(34, 197, 94, 0.55)',
  bullFillMit: 'rgba(34, 197, 94, 0.04)',
  bullStrokeMit: 'rgba(34, 197, 94, 0.28)',

  bearFill: 'rgba(239, 68, 68, 0.10)', // rose-500
  bearStroke: 'rgba(239, 68, 68, 0.55)',
  bearFillMit: 'rgba(239, 68, 68, 0.04)',
  bearStrokeMit: 'rgba(239, 68, 68, 0.28)',

  liqHigh: 'rgba(244, 114, 182, 0.85)', // pink-400
  liqHighSwept: 'rgba(244, 114, 182, 0.35)',
  liqLow: 'rgba(56, 189, 248, 0.85)', // sky-400
  liqLowSwept: 'rgba(56, 189, 248, 0.35)',

  label: 'rgba(229, 231, 235, 0.92)', // gray-200
  labelShadow: 'rgba(15, 23, 42, 0.85)', // slate-900
} as const;

// ============================================================================
// Публичный API
// ============================================================================

export interface RenderSmcOverlayArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  overlay: SmcOverlay;
}

export function renderSmcOverlay({
  ctx,
  metrics,
  viewport,
  overlay,
}: RenderSmcOverlayArgs): void {
  if (overlay.fvgs.length === 0 && overlay.liquidity.length === 0) return;

  // FVG рисуем первыми — они «зональные», горизонталки ликвидности должны
  // оказаться поверх и не теряться.
  for (const fvg of overlay.fvgs) {
    drawFvg(ctx, metrics, viewport, fvg);
  }
  for (const liq of overlay.liquidity) {
    drawLiquidity(ctx, metrics, viewport, liq);
  }
}

// ============================================================================
// FVG
// ============================================================================

function drawFvg(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  fvg: FvgZone,
): void {
  const x1 = timeToX(fvg.startTime, vp, metrics);
  const x2 = timeToX(fvg.endTime, vp, metrics);
  const y1 = priceToY(fvg.maxPrice, vp, metrics);
  const y2 = priceToY(fvg.minPrice, vp, metrics);
  const x = Math.min(x1, x2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const y = Math.min(y1, y2);
  const h = Math.max(1, Math.abs(y2 - y1));

  if (x + w < 0 || x > metrics.width) return;
  if (y + h < 0 || y > metrics.height) return;

  const isBull = fvg.kind === 'bull';
  const fill = isBull
    ? fvg.unmitigated ? COLORS.bullFill : COLORS.bullFillMit
    : fvg.unmitigated ? COLORS.bearFill : COLORS.bearFillMit;
  const stroke = isBull
    ? fvg.unmitigated ? COLORS.bullStroke : COLORS.bullStrokeMit
    : fvg.unmitigated ? COLORS.bearStroke : COLORS.bearStrokeMit;

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  if (!fvg.unmitigated) ctx.setLineDash([3, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
}

// ============================================================================
// Liquidity
// ============================================================================

function drawLiquidity(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  liq: LiquidityZone,
): void {
  const y = priceToY(liq.price, vp, metrics);
  if (y < 0 || y > metrics.height) return;

  const x1Raw = timeToX(liq.startTime, vp, metrics);
  const x2Raw = timeToX(liq.endTime, vp, metrics);
  const xLeft = Math.max(0, Math.min(x1Raw, x2Raw));
  const xRight = Math.min(metrics.width, Math.max(x1Raw, x2Raw));
  if (xRight <= xLeft) return;

  const isHigh = liq.kind === 'high';
  const swept = liq.sweep !== null;
  const stroke = isHigh
    ? swept ? COLORS.liqHighSwept : COLORS.liqHigh
    : swept ? COLORS.liqLowSwept : COLORS.liqLow;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = swept ? 1 : 1.25;
  ctx.setLineDash(swept ? [2, 4] : [6, 4]);
  ctx.beginPath();
  ctx.moveTo(xLeft, y + 0.5);
  ctx.lineTo(xRight, y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  // Маркер sweep
  if (swept && liq.sweep) {
    const xs = timeToX(liq.sweep.time, vp, metrics);
    if (xs >= 0 && xs <= metrics.width) {
      drawSweepMark(ctx, xs, y, isHigh);
    }
  }

  // Текстовая подпись (кратко: EQH×N / EQL×N или SWEPT)
  drawLiqLabel(ctx, xLeft + 4, y, liq);
}

function drawSweepMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isHigh: boolean,
): void {
  const size = 4;
  ctx.save();
  ctx.strokeStyle = isHigh ? COLORS.liqHigh : COLORS.liqLow;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
  ctx.restore();
}

function drawLiqLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  liq: LiquidityZone,
): void {
  const tag = liq.kind === 'high' ? 'EQH' : 'EQL';
  const sweptTag = liq.sweep ? ' SWEPT' : '';
  const text = `${tag}×${liq.touches}${sweptTag}`;

  ctx.save();
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.labelShadow;
  // Тонкая тёмная плашка под текстом — чтобы читалось поверх свечей
  const padX = 3;
  const padY = 2;
  const w = ctx.measureText(text).width;
  const labelY = liq.kind === 'high' ? y - 8 : y + 8;
  ctx.fillRect(x - padX, labelY - 6 - padY, w + padX * 2, 12 + padY * 2);
  ctx.fillStyle = COLORS.label;
  ctx.fillText(text, x, labelY);
  ctx.restore();
}
