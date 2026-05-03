/**
 * Рендер маркеров сигналов сканера на 5m-графике + hit-test для интерактива.
 *
 *   LONG  — зелёный треугольник вверх (▲) ниже свечи (под low)
 *   SHORT — красный треугольник вниз  (▼) выше свечи (над high)
 *
 * Размер маркера задаётся в CSS-пикселях (не в ценовых единицах),
 * чтобы при изменении масштаба он не «расползался».
 *
 * Состояния маркера:
 *   - normal   — обычный размер MARKER_SIZE_PX
 *   - hovered  — крупнее на HOVER_SCALE, белая обводка
 *   - selected — крупнее на SELECTED_SCALE, золотая обводка + утолщённая линия
 */

import { candleDurationMs, candleWidthPx, priceToY, timeToX } from './scale';
import type { CanvasMetrics, Viewport } from './scale';
import type { Signal } from '@/types';

const COLOR = {
  long: '#089981',
  short: '#f23645',
  hover: '#ffffff',
  selected: '#fbbf24', // янтарь — хорошо контрастирует и с зелёным, и с красным
} as const;

const MARKER_SIZE_PX = 8;
const MARKER_GAP_PX = 6;
const HOVER_SCALE = 1.35;
const SELECTED_SCALE = 1.6;
/** Хитбокс делаем чуть больше визуального треугольника — иначе мышь промахивается. */
const HITBOX_PADDING_PX = 4;

/**
 * Таймфрейм центра маркера сигнала.
 *
 * 5m / 15m — стандартные LTF в двухуровневых парах.
 * 1h       — single-режим '1h-1h', где зоны и сканер работают на одном часе.
 */
export type LtfMarkerTf = '5m' | '15m' | '1h';

/** Прямоугольник на canvas, по которому ловим hover/click сигнала. */
export interface SignalHitbox {
  signalId: string;
  x: number; // top-left
  y: number;
  w: number;
  h: number;
}

/**
 * Возвращает массив hitbox-ов для всех видимых сигналов.
 *
 * Чистая функция от viewport+metrics+signals: вызывается и при рендере,
 * и при mousemove. Это исключает рассинхронизацию хитбокса и пикселей.
 */
export function computeSignalHitboxes(
  signals: readonly Signal[],
  viewport: Viewport,
  metrics: CanvasMetrics,
  ltfChartTf: LtfMarkerTf,
): SignalHitbox[] {
  if (signals.length === 0) return [];

  const result: SignalHitbox[] = [];
  const halfSlot = candleDurationMs(ltfChartTf) / 2;
  for (const sig of signals) {
    const xCenter = timeToX(sig.candleTime + halfSlot, viewport, metrics);
    const yPrice = priceToY(sig.price, viewport, metrics);
    if (xCenter < -20 || xCenter > metrics.width + 20) continue;
    if (yPrice < -20 || yPrice > metrics.height + 20) continue;

    const isLong = sig.type === 'LONG';
    const halfW = MARKER_SIZE_PX / 2;
    const tipY = isLong ? yPrice + MARKER_GAP_PX : yPrice - MARKER_GAP_PX;
    const baseY = isLong ? tipY + MARKER_SIZE_PX : tipY - MARKER_SIZE_PX;

    // Хитбокс — прямоугольник, объединяющий tip и base маркера, с padding.
    const top = Math.min(tipY, baseY) - HITBOX_PADDING_PX;
    const bot = Math.max(tipY, baseY) + HITBOX_PADDING_PX;
    result.push({
      signalId: sig.id,
      x: xCenter - halfW - HITBOX_PADDING_PX,
      y: top,
      w: MARKER_SIZE_PX + HITBOX_PADDING_PX * 2,
      h: bot - top,
    });
  }
  return result;
}

/** Возвращает signalId, попавший под (x, y), либо null. */
export function hitTestSignals(
  hitboxes: readonly SignalHitbox[],
  x: number,
  y: number,
): string | null {
  // Идём с конца — позже отрисованные маркеры приоритетнее (как у POI).
  for (let i = hitboxes.length - 1; i >= 0; i--) {
    const h = hitboxes[i]!;
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      return h.signalId;
    }
  }
  return null;
}

export interface RenderSignalsArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  signals: readonly Signal[];
  /** Младший ТФ (5m / 15m) — ширина слота для центра маркера. */
  ltfChartTf: LtfMarkerTf;
  hoveredSignalId?: string | null;
  selectedSignalId?: string | null;
}

export function renderSignals({
  ctx,
  metrics,
  viewport,
  signals,
  ltfChartTf,
  hoveredSignalId = null,
  selectedSignalId = null,
}: RenderSignalsArgs): void {
  if (signals.length === 0) return;

  const cwPx = candleWidthPx(ltfChartTf, viewport, metrics);
  const halfSlot = candleDurationMs(ltfChartTf) / 2;

  // Сначала рисуем все обычные маркеры. Selected рисуем последним, чтобы он был сверху.
  const ordered = [...signals].sort((a, b) => {
    if (a.id === selectedSignalId) return 1;
    if (b.id === selectedSignalId) return -1;
    return 0;
  });

  for (const sig of ordered) {
    const xCenter = timeToX(sig.candleTime + halfSlot, viewport, metrics);
    const yPrice = priceToY(sig.price, viewport, metrics);

    if (xCenter < -20 || xCenter > metrics.width + 20) continue;
    if (yPrice < -20 || yPrice > metrics.height + 20) continue;

    const isLong = sig.type === 'LONG';
    const isSelected = sig.id === selectedSignalId;
    const isHovered = sig.id === hoveredSignalId && !isSelected;

    const scale = isSelected ? SELECTED_SCALE : isHovered ? HOVER_SCALE : 1;
    const size = MARKER_SIZE_PX * scale;
    const halfW = size / 2;
    const gap = MARKER_GAP_PX;
    const tipY = isLong ? yPrice + gap : yPrice - gap;
    const baseY = isLong ? tipY + size : tipY - size;

    // Привязочная линия от свечи к маркеру: для selected усиленная, для остальных — тонкая.
    if (cwPx >= 6) {
      const xCol = Math.round(xCenter) + 0.5;
      ctx.strokeStyle = isSelected
        ? COLOR.selected
        : isLong
          ? 'rgba(8, 153, 129, 0.4)'
          : 'rgba(242, 54, 69, 0.4)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(xCol, yPrice);
      ctx.lineTo(xCol, tipY);
      ctx.stroke();
    }

    // Заливка треугольника
    ctx.fillStyle = isLong ? COLOR.long : COLOR.short;
    ctx.beginPath();
    ctx.moveTo(xCenter, tipY);
    ctx.lineTo(xCenter - halfW, baseY);
    ctx.lineTo(xCenter + halfW, baseY);
    ctx.closePath();
    ctx.fill();

    // Обводка по состоянию
    if (isSelected) {
      ctx.strokeStyle = COLOR.selected;
      ctx.lineWidth = 2.5;
    } else if (isHovered) {
      ctx.strokeStyle = COLOR.hover;
      ctx.lineWidth = 1.75;
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
    }
    ctx.stroke();

    // Для selected — мягкое внешнее свечение в виде второго контура.
    if (isSelected) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  }
}
