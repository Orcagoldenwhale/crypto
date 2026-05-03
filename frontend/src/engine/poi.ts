/**
 * Рендер POI-зон (Order Blocks / FVG, размечаются вручную пользователем).
 *
 * Стили:
 *   - обычная зона                           — синяя рамка + полупрозрачная заливка
 *   - зона со сканер-сигналом (hasSignal)    — зелёная плотная рамка + ярче заливка
 *   - выделенная зона (selectedZoneId)       — жёлтая обводка поверх (фокус)
 *   - временная зона при рисовании (drag)    — пунктирная жёлтая
 *
 * Также экспортирует hit-test для попадания мыши в зону (нужно для
 * клика по зоне → контекстное меню).
 */

import { priceToY, timeToX, xToTime, yToPrice } from './scale';
import type { CanvasMetrics, Viewport } from './scale';
import type { POIZone, TimestampMs, Price } from '@/types';

// ============================================================================
// Цвета (синхронизированы с темой Tailwind)
// ============================================================================

const COLORS = {
  normalFill: 'rgba(41, 98, 255, 0.10)', // tv-accent
  normalStroke: 'rgba(41, 98, 255, 0.55)',
  signalFill: 'rgba(8, 153, 129, 0.16)', // tv-up
  signalStroke: 'rgba(8, 153, 129, 0.85)',
  selectedStroke: 'rgba(234, 179, 8, 0.95)', // amber-500
  drawingFill: 'rgba(234, 179, 8, 0.12)',
  drawingStroke: 'rgba(234, 179, 8, 0.85)',
} as const;

// ============================================================================
// Координатные хелперы
// ============================================================================

interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function zoneToRect(zone: POIZone, vp: Viewport, metrics: CanvasMetrics): ZoneRect {
  const x1 = timeToX(zone.startTime, vp, metrics);
  const x2 = timeToX(zone.endTime, vp, metrics);
  const y1 = priceToY(zone.maxPrice, vp, metrics);
  const y2 = priceToY(zone.minPrice, vp, metrics);
  const x = Math.min(x1, x2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const y = Math.min(y1, y2);
  const h = Math.max(1, Math.abs(y2 - y1));
  return { x, y, w, h };
}

// ============================================================================
// Рендер всех POI-зон
// ============================================================================

export interface RenderPOIsArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  zones: readonly POIZone[];
  selectedZoneId: string | null;
}

export function renderPOIs({
  ctx,
  metrics,
  viewport,
  zones,
  selectedZoneId,
}: RenderPOIsArgs): void {
  for (const zone of zones) {
    const r = zoneToRect(zone, viewport, metrics);
    // Не рисуем зоны полностью за пределами видимой области
    if (r.x + r.w < 0 || r.x > metrics.width || r.y + r.h < 0 || r.y > metrics.height) {
      continue;
    }

    const isSignal = zone.hasSignal;
    ctx.fillStyle = isSignal ? COLORS.signalFill : COLORS.normalFill;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.strokeStyle = isSignal ? COLORS.signalStroke : COLORS.normalStroke;
    ctx.lineWidth = isSignal ? 1.5 : 1;
    if (!isSignal) ctx.setLineDash([4, 3]);
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    ctx.setLineDash([]);
  }

  // Выделенная зона — поверх остальных, жёлтая рамка
  if (selectedZoneId) {
    const sel = zones.find((z) => z.id === selectedZoneId);
    if (sel) {
      const r = zoneToRect(sel, viewport, metrics);
      ctx.strokeStyle = COLORS.selectedStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
  }
}

// ============================================================================
// Рендер «временной» зоны при рисовании (drag-in-progress)
// ============================================================================

export interface DraftZoneCoords {
  startTime: TimestampMs;
  endTime: TimestampMs;
  startPrice: Price;
  endPrice: Price;
}

export interface RenderDraftZoneArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  draft: DraftZoneCoords | null;
}

export function renderDraftZone({ ctx, metrics, viewport, draft }: RenderDraftZoneArgs): void {
  if (!draft) return;

  const x1 = timeToX(draft.startTime, viewport, metrics);
  const x2 = timeToX(draft.endTime, viewport, metrics);
  const y1 = priceToY(draft.startPrice, viewport, metrics);
  const y2 = priceToY(draft.endPrice, viewport, metrics);

  const x = Math.min(x1, x2);
  const w = Math.max(1, Math.abs(x2 - x1));
  const y = Math.min(y1, y2);
  const h = Math.max(1, Math.abs(y2 - y1));

  ctx.fillStyle = COLORS.drawingFill;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = COLORS.drawingStroke;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.setLineDash([]);
}

// ============================================================================
// Hit-test: попадание точки в зону
// ============================================================================

export function hitTestZones(
  zones: readonly POIZone[],
  cursorX: number,
  cursorY: number,
  vp: Viewport,
  metrics: CanvasMetrics,
): POIZone | null {
  // Идём с конца — последние нарисованные сверху, должны выигрывать в hit-test
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    if (!zone) continue;
    const r = zoneToRect(zone, vp, metrics);
    if (cursorX >= r.x && cursorX <= r.x + r.w && cursorY >= r.y && cursorY <= r.y + r.h) {
      return zone;
    }
  }
  return null;
}

// ============================================================================
// Конвертация экранных координат в "мировые" для создания зоны
// ============================================================================

export function screenRectToZoneCoords(
  startScreenX: number,
  startScreenY: number,
  endScreenX: number,
  endScreenY: number,
  vp: Viewport,
  metrics: CanvasMetrics,
): DraftZoneCoords {
  return {
    startTime: xToTime(startScreenX, vp, metrics),
    endTime: xToTime(endScreenX, vp, metrics),
    startPrice: yToPrice(startScreenY, vp, metrics),
    endPrice: yToPrice(endScreenY, vp, metrics),
  };
}
