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
import type {
  BreakerBlockZone,
  FvgZone,
  LiquidityZone,
  OrderBlockZone,
  PrevDayLevelZone,
  RejectionBlockZone,
  SmcOverlay,
  StructureBreak,
} from './types';

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

  // Previous Day High/Low — приглушённый белый, чтобы не конкурировать с EQH/EQL.
  pdhActive: 'rgba(229, 231, 235, 0.85)',
  pdhMitigated: 'rgba(229, 231, 235, 0.30)',

  // Структура: BOS — насыщенные «трендовые» цвета; CHoCH — контрастные янтарные.
  bosUp: 'rgba(34, 197, 94, 0.95)', // emerald-500
  bosDown: 'rgba(239, 68, 68, 0.95)', // rose-500
  chochUp: 'rgba(250, 204, 21, 0.95)', // yellow-400
  chochDown: 'rgba(249, 115, 22, 0.95)', // orange-500
  retest: 'rgba(234, 179, 8, 0.95)', // amber-500

  // Order Blocks — заметнее FVG (плотнее заливка, толще контур).
  obBullFill: 'rgba(34, 197, 94, 0.16)', // emerald-500
  obBullStroke: 'rgba(34, 197, 94, 0.85)',
  obBullFillMit: 'rgba(34, 197, 94, 0.06)',
  obBullStrokeMit: 'rgba(34, 197, 94, 0.4)',
  obBearFill: 'rgba(239, 68, 68, 0.16)', // rose-500
  obBearStroke: 'rgba(239, 68, 68, 0.85)',
  obBearFillMit: 'rgba(239, 68, 68, 0.06)',
  obBearStrokeMit: 'rgba(239, 68, 68, 0.4)',

  // Breaker Blocks — фиолетовый оттенок (это пробитый OB, отличается визуально).
  bbBullFill: 'rgba(168, 85, 247, 0.14)', // purple-500
  bbBullStroke: 'rgba(168, 85, 247, 0.85)',
  bbBullFillMit: 'rgba(168, 85, 247, 0.05)',
  bbBullStrokeMit: 'rgba(168, 85, 247, 0.4)',
  bbBearFill: 'rgba(217, 70, 239, 0.14)', // fuchsia-500
  bbBearStroke: 'rgba(217, 70, 239, 0.85)',
  bbBearFillMit: 'rgba(217, 70, 239, 0.05)',
  bbBearStrokeMit: 'rgba(217, 70, 239, 0.4)',

  // Rejection Blocks — бирюзовый/янтарный оттенок, чтобы отличаться.
  rbBullFill: 'rgba(20, 184, 166, 0.16)', // teal-500
  rbBullStroke: 'rgba(20, 184, 166, 0.85)',
  rbBullFillMit: 'rgba(20, 184, 166, 0.05)',
  rbBullStrokeMit: 'rgba(20, 184, 166, 0.4)',
  rbBearFill: 'rgba(245, 158, 11, 0.16)', // amber-500
  rbBearStroke: 'rgba(245, 158, 11, 0.85)',
  rbBearFillMit: 'rgba(245, 158, 11, 0.05)',
  rbBearStrokeMit: 'rgba(245, 158, 11, 0.4)',

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
  /** Использовать BSL/SSL вместо EQH/EQL в подписях. */
  useBslSslLabels?: boolean;
}

export function renderSmcOverlay({
  ctx,
  metrics,
  viewport,
  overlay,
  useBslSslLabels,
}: RenderSmcOverlayArgs): void {
  if (
    overlay.fvgs.length === 0 &&
    overlay.liquidity.length === 0 &&
    overlay.structure.length === 0 &&
    overlay.orderBlocks.length === 0 &&
    overlay.breakerBlocks.length === 0 &&
    overlay.rejectionBlocks.length === 0 &&
    overlay.prevDayLevels.length === 0
  ) {
    return;
  }

  for (const fvg of overlay.fvgs) {
    drawFvg(ctx, metrics, viewport, fvg);
  }
  for (const ob of overlay.orderBlocks) {
    drawOrderBlock(ctx, metrics, viewport, ob);
  }
  for (const bb of overlay.breakerBlocks) {
    drawBreakerBlock(ctx, metrics, viewport, bb);
  }
  for (const rb of overlay.rejectionBlocks) {
    drawRejectionBlock(ctx, metrics, viewport, rb);
  }
  for (const liq of overlay.liquidity) {
    drawLiquidity(ctx, metrics, viewport, liq, !!useBslSslLabels);
  }
  for (const p of overlay.prevDayLevels) {
    drawPrevDayLevel(ctx, metrics, viewport, p);
  }
  for (const sb of overlay.structure) {
    drawStructureBreak(ctx, metrics, viewport, sb);
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
  useBslSslLabels: boolean,
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
  drawLiqLabel(ctx, xLeft + 4, y, liq, useBslSslLabels);
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
  useBslSslLabels: boolean,
): void {
  const baseTag = useBslSslLabels
    ? liq.kind === 'high' ? 'BSL' : 'SSL'
    : liq.kind === 'high' ? 'EQH' : 'EQL';
  const posTag =
    liq.position === 'external' ? ' EXT' :
    liq.position === 'internal' ? ' INT' : '';
  const sweptTag = liq.sweep ? ' SWEPT' : '';
  const text = `${baseTag}×${liq.touches}${posTag}${sweptTag}`;

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

// ============================================================================
// Структура (BOS / CHoCH)
// ============================================================================

function drawStructureBreak(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  sb: StructureBreak,
): void {
  const y = priceToY(sb.level, vp, metrics);
  if (y < 0 || y > metrics.height) return;

  const xLevel = timeToX(sb.levelTime, vp, metrics);
  const xBreak = timeToX(sb.breakTime, vp, metrics);
  const xLeft = Math.max(0, Math.min(xLevel, xBreak));
  const xRight = Math.min(metrics.width, Math.max(xLevel, xBreak));
  if (xRight <= xLeft) return;

  const stroke = colorForBreak(sb);

  // Сама линия — сплошная, чуть толще остальных оверлеев, чтобы выделяться.
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(xLeft, y + 0.5);
  ctx.lineTo(xRight, y + 0.5);
  ctx.stroke();

  // Маленький треугольник-стрелка у break-точки, показывает направление
  // пробоя — направлен ВВЕРХ для break↑ (значок «преодолели сопротивление»)
  // и вниз для break↓.
  drawBreakArrow(ctx, xRight, y, sb.dir, stroke);

  // Подпись "BOS↑" / "CHoCH↓" сразу за break-точкой.
  drawBreakLabel(ctx, xRight + 8, y, sb);

  // Retest: тонкий пунктир от break-точки до retest-свечи + маркер.
  if (sb.retestTime !== null) {
    const xR = timeToX(sb.retestTime, vp, metrics);
    if (xR > xRight && xR <= metrics.width) {
      ctx.strokeStyle = COLORS.retest;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(xRight, y + 0.5);
      ctx.lineTo(xR, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      drawRetestMark(ctx, xR, y);
    }
  }
  ctx.restore();
}

function colorForBreak(sb: StructureBreak): string {
  if (sb.kind === 'BOS') {
    return sb.dir === 'up' ? COLORS.bosUp : COLORS.bosDown;
  }
  return sb.dir === 'up' ? COLORS.chochUp : COLORS.chochDown;
}

function drawBreakArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dir: 'up' | 'down',
  color: string,
): void {
  const size = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (dir === 'up') {
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y - size);
  } else {
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
  }
  ctx.closePath();
  ctx.fill();
}

function drawBreakLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sb: StructureBreak,
): void {
  const arrow = sb.dir === 'up' ? '↑' : '↓';
  const text = `${sb.kind}${arrow}`;

  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const padX = 3;
  const padY = 2;
  const w = ctx.measureText(text).width;
  // Подпись над линией для up-break и под линией для down-break — глаз
  // привычнее ищет текст в этой полусфере.
  const labelY = sb.dir === 'up' ? y - 8 : y + 8;
  ctx.fillStyle = COLORS.labelShadow;
  ctx.fillRect(x - padX, labelY - 6 - padY, w + padX * 2, 12 + padY * 2);
  ctx.fillStyle = colorForBreak(sb);
  ctx.fillText(text, x, labelY);
}

function drawRetestMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  // Полый кружок поверх линии — символ «вернулись потрогать».
  ctx.save();
  ctx.strokeStyle = COLORS.retest;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// Order Blocks
// ============================================================================

function drawOrderBlock(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  ob: OrderBlockZone,
): void {
  const x1 = timeToX(ob.obTime, vp, metrics);
  const x2 = timeToX(ob.endTime, vp, metrics);
  const y1 = priceToY(ob.maxPrice, vp, metrics);
  const y2 = priceToY(ob.minPrice, vp, metrics);
  const x = Math.min(x1, x2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const y = Math.min(y1, y2);
  const h = Math.max(1, Math.abs(y2 - y1));

  if (x + w < 0 || x > metrics.width) return;
  if (y + h < 0 || y > metrics.height) return;

  const isBull = ob.kind === 'bull';
  const fill = isBull
    ? ob.unmitigated ? COLORS.obBullFill : COLORS.obBullFillMit
    : ob.unmitigated ? COLORS.obBearFill : COLORS.obBearFillMit;
  const stroke = isBull
    ? ob.unmitigated ? COLORS.obBullStroke : COLORS.obBullStrokeMit
    : ob.unmitigated ? COLORS.obBearStroke : COLORS.obBearStrokeMit;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = ob.unmitigated ? 1.25 : 1;
  // Mitigated → штриховка, чтобы зоны зрительно «гасились».
  if (!ob.unmitigated) ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
  ctx.restore();

  // Подпись: "OB↑" / "OB↓" + возможный значок "+FVG" если был разрыв в
  // импульсе (классический «strong OB»).
  drawObLabel(ctx, x + 4, y, ob, stroke);
}

function drawObLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  yTop: number,
  ob: OrderBlockZone,
  color: string,
): void {
  const arrow = ob.kind === 'bull' ? '↑' : '↓';
  const fvgTag = ob.hasFvg ? ' +FVG' : '';
  const text = `OB${arrow} (${ob.breakKind})${fvgTag}`;

  ctx.save();
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  // Подпись рисуем сразу под верхней границей (для bull) или над верхней
  // границей (для bear) — чтобы не наезжать на середину зоны.
  const padX = 3;
  const padY = 2;
  const w = ctx.measureText(text).width;
  const labelY = ob.kind === 'bull' ? yTop + 8 : yTop - 8;
  ctx.fillStyle = COLORS.labelShadow;
  ctx.fillRect(x - padX, labelY - 6 - padY, w + padX * 2, 12 + padY * 2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, labelY);
  ctx.restore();
}

function drawBreakerBlock(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  bb: BreakerBlockZone,
): void {
  const x1 = timeToX(bb.obTime, vp, metrics);
  const x2 = timeToX(bb.endTime, vp, metrics);
  const y1 = priceToY(bb.maxPrice, vp, metrics);
  const y2 = priceToY(bb.minPrice, vp, metrics);
  const x = Math.min(x1, x2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const y = Math.min(y1, y2);
  const h = Math.max(1, Math.abs(y2 - y1));

  if (x + w < 0 || x > metrics.width) return;
  if (y + h < 0 || y > metrics.height) return;

  const isBull = bb.kind === 'bull';
  const fill = isBull
    ? bb.unmitigated ? COLORS.bbBullFill : COLORS.bbBullFillMit
    : bb.unmitigated ? COLORS.bbBearFill : COLORS.bbBearFillMit;
  const stroke = isBull
    ? bb.unmitigated ? COLORS.bbBullStroke : COLORS.bbBullStrokeMit
    : bb.unmitigated ? COLORS.bbBearStroke : COLORS.bbBearStrokeMit;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = bb.unmitigated ? 1.25 : 1;
  if (!bb.unmitigated) ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
  ctx.restore();

  // Подпись: BB↑/BB↓.
  const arrow = isBull ? '↑' : '↓';
  const text = `BB${arrow}`;
  ctx.save();
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const padX = 3;
  const padY = 2;
  const tw = ctx.measureText(text).width;
  const labelY = isBull ? y + 8 : y - 8;
  ctx.fillStyle = COLORS.labelShadow;
  ctx.fillRect(x + 4 - padX, labelY - 6 - padY, tw + padX * 2, 12 + padY * 2);
  ctx.fillStyle = stroke;
  ctx.fillText(text, x + 4, labelY);
  ctx.restore();
}

function drawRejectionBlock(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  rb: RejectionBlockZone,
): void {
  const x1 = timeToX(rb.obTime, vp, metrics);
  const x2 = timeToX(rb.endTime, vp, metrics);
  const y1 = priceToY(rb.maxPrice, vp, metrics);
  const y2 = priceToY(rb.minPrice, vp, metrics);
  const x = Math.min(x1, x2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const y = Math.min(y1, y2);
  const h = Math.max(1, Math.abs(y2 - y1));

  if (x + w < 0 || x > metrics.width) return;
  if (y + h < 0 || y > metrics.height) return;

  const isBull = rb.kind === 'bull';
  const fill = isBull
    ? rb.unmitigated ? COLORS.rbBullFill : COLORS.rbBullFillMit
    : rb.unmitigated ? COLORS.rbBearFill : COLORS.rbBearFillMit;
  const stroke = isBull
    ? rb.unmitigated ? COLORS.rbBullStroke : COLORS.rbBullStrokeMit
    : rb.unmitigated ? COLORS.rbBearStroke : COLORS.rbBearStrokeMit;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = rb.unmitigated ? 1.25 : 1;
  if (!rb.unmitigated) ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
  ctx.restore();

  // Подпись RB с пометкой sweep.
  const arrow = isBull ? '↑' : '↓';
  const sweepTag = rb.hasSweep ? ' ✕' : '';
  const text = `RB${arrow}${sweepTag}`;
  ctx.save();
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const padX = 3;
  const padY = 2;
  const tw = ctx.measureText(text).width;
  const labelY = isBull ? y + 8 : y - 8;
  ctx.fillStyle = COLORS.labelShadow;
  ctx.fillRect(x + 4 - padX, labelY - 6 - padY, tw + padX * 2, 12 + padY * 2);
  ctx.fillStyle = stroke;
  ctx.fillText(text, x + 4, labelY);
  ctx.restore();
}

// ============================================================================
// Previous Day High/Low
// ============================================================================

function drawPrevDayLevel(
  ctx: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  vp: Viewport,
  p: PrevDayLevelZone,
): void {
  const y = priceToY(p.price, vp, metrics);
  if (y < 0 || y > metrics.height) return;

  const xLeft = Math.max(0, timeToX(p.startTime, vp, metrics));
  const xRight = Math.min(metrics.width, timeToX(p.endTime, vp, metrics));
  if (xRight <= xLeft) return;

  const color = p.unmitigated ? COLORS.pdhActive : COLORS.pdhMitigated;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(p.unmitigated ? [8, 4] : [2, 4]);
  ctx.beginPath();
  ctx.moveTo(xLeft, y + 0.5);
  ctx.lineTo(xRight, y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Подпись: PDH/PDL + дата.
  const tag = p.kind === 'high' ? 'PDH' : 'PDL';
  const text = `${tag} ${p.sourceDate.slice(5)} ${p.price.toFixed(2)}`;
  ctx.save();
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  const padX = 3;
  const padY = 2;
  const w = ctx.measureText(text).width;
  const labelY = p.kind === 'high' ? y - 8 : y + 8;
  ctx.fillStyle = COLORS.labelShadow;
  ctx.fillRect(xLeft + 4 - padX, labelY - 6 - padY, w + padX * 2, 12 + padY * 2);
  ctx.fillStyle = color;
  ctx.fillText(text, xLeft + 4, labelY);
  ctx.restore();
}
