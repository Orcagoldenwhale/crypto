/**
 * Рендер перекрестия (crosshair) — горизонтальная и вертикальная линии,
 * следующие за курсором. Рисуется на ОТДЕЛЬНОМ overlay-canvas,
 * чтобы не перерисовывать тяжёлый main-canvas каждый mousemove.
 */

import { chartHeight, chartWidth } from './scale';
import type { CanvasMetrics } from './scale';

const COLOR = 'rgba(148, 163, 184, 0.5)';

export interface CrosshairArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  /** Координаты курсора в CSS-пикселях относительно canvas, или null чтобы стереть */
  cursorX: number | null;
  cursorY: number | null;
}

export function renderCrosshair({ ctx, metrics, cursorX, cursorY }: CrosshairArgs): void {
  // Полная очистка overlay
  ctx.clearRect(0, 0, metrics.width, metrics.height);

  if (cursorX === null || cursorY === null) return;

  const cw = chartWidth(metrics);
  const ch = chartHeight(metrics);

  // Не рисуем, если курсор вышел из chart-области
  if (cursorX < 0 || cursorX > cw || cursorY < 0 || cursorY > ch) return;

  ctx.strokeStyle = COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  // Горизонтальная (на всю ширину chart)
  const yR = Math.round(cursorY) + 0.5;
  ctx.beginPath();
  ctx.moveTo(0, yR);
  ctx.lineTo(cw, yR);
  ctx.stroke();

  // Вертикальная (на всю высоту chart)
  const xR = Math.round(cursorX) + 0.5;
  ctx.beginPath();
  ctx.moveTo(xR, 0);
  ctx.lineTo(xR, ch);
  ctx.stroke();

  ctx.setLineDash([]);
}
