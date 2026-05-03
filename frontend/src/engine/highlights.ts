/**
 * Подсветка условий входа выбранного сигнала на 5m-графике.
 *
 * Когда пользователь кликает на маркер сигнала, мы должны "разобрать" сделку
 * визуально — показать, какие именно элементы свечи дают каждое из 4 правил:
 *
 *   R1 polarity     →  горизонтальная линия mid = (high+low)/2 + бэйдж
 *                       («close 65 432 > mid 65 401» для LONG)
 *   R2 totalDelta   →  бэйдж сверху от свечи с числом Δ (зелёный/красный)
 *   R3 closeVsVpoc  →  горизонтальная линия на vpoc_price + бэйдж
 *                       («close > vpoc» / «close < vpoc»)
 *   R4 absorption   →  outline на ячейке кластера в low (LONG) или high (SHORT)
 *                       + бэйдж со значением delta_at_low/high
 *
 * Плюс — золотая рамка вокруг самой свечи, чтобы её было сразу видно.
 *
 * Рисуется ПОВЕРХ свечей и кластеров, но ПОД маркерами сигналов и crosshair.
 */

import { candleDurationMs, candleWidthPx, priceToY, timeToX } from './scale';
import type { CanvasMetrics, Viewport } from './scale';
import type { Candle5m, Signal } from '@/types';
import { FOOTPRINT_MIN_WIDTH_PX } from './footprint';

const COLOR = {
  accent: '#fbbf24',
  accentSoft: 'rgba(251, 191, 36, 0.20)',
  accentBorder: 'rgba(251, 191, 36, 0.55)',
  long: '#089981',
  short: '#f23645',
  textOnDark: '#ffffff',
  badgeBg: 'rgba(15, 23, 42, 0.92)',
  badgeBorder: 'rgba(251, 191, 36, 0.5)',
  warn: '#fb923c',
  muted: '#64748b',
  mutedText: '#94a3b8',
} as const;

export interface RenderHighlightArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  /** Свеча, на которой стоит сигнал (timestamp == signal.candleTime). */
  candle: Candle5m;
  signal: Signal;
  /**
   * Таймфрейм отрисовки (5m / 15m / 1h).
   * 1h применяется в single-режиме '1h-1h'.
   */
  chartTf: '5m' | '15m' | '1h';
}

function detectTickSize(clusters: Candle5m['clusters']): number {
  if (clusters.length < 2) return 0;
  const a = clusters[0]?.price;
  const b = clusters[1]?.price;
  if (a === undefined || b === undefined) return 0;
  return Math.max(0, b - a);
}

/**
 * Главная функция подсветки. Вызывается ровно для одной свечи —
 * той, на которой выбран сигнал.
 */
export function renderSignalHighlight({
  ctx,
  metrics,
  viewport,
  candle,
  signal,
  chartTf,
}: RenderHighlightArgs): void {
  if (signal.candleTime !== candle.timestamp) return;

  const cwPx = candleWidthPx(chartTf, viewport, metrics);
  const isFootprint = cwPx >= FOOTPRINT_MIN_WIDTH_PX && candle.clusters.length >= 2;
  const isLong = signal.type === 'LONG';

  const xCenter = timeToX(candle.timestamp + candleDurationMs(chartTf) / 2, viewport, metrics);
  if (xCenter < -50 || xCenter > metrics.width + 50) return;

  const mid = (candle.high + candle.low) / 2;
  const cellWidthPx = cwPx * 0.9;
  const xLeft = Math.round(xCenter - cellWidthPx / 2);
  const xRight = xLeft + Math.round(cellWidthPx);
  const yHigh = Math.round(priceToY(candle.high, viewport, metrics));
  const yLow = Math.round(priceToY(candle.low, viewport, metrics));
  const yMid = Math.round(priceToY(mid, viewport, metrics));
  const yClose = Math.round(priceToY(candle.close, viewport, metrics));
  const yVpoc = Math.round(priceToY(candle.vpoc_price, viewport, metrics));

  // ==========================================================================
  // 1) Золотая рамка вокруг свечи + лёгкая заливка
  // ==========================================================================
  ctx.save();
  ctx.fillStyle = COLOR.accentSoft;
  const padX = 4;
  const padY = 6;
  const fillX = xLeft - padX;
  const fillY = Math.min(yHigh, yLow) - padY;
  const fillW = xRight - xLeft + padX * 2;
  const fillH = Math.abs(yLow - yHigh) + padY * 2;
  ctx.fillRect(fillX, fillY, fillW, fillH);

  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(fillX + 0.5, fillY + 0.5, fillW - 1, fillH - 1);

  // Угловые "уголки" Г-образные — TradingView-style маркер выделения.
  ctx.lineWidth = 2;
  const corner = 8;
  ctx.beginPath();
  ctx.moveTo(fillX, fillY + corner);
  ctx.lineTo(fillX, fillY);
  ctx.lineTo(fillX + corner, fillY);
  ctx.moveTo(fillX + fillW - corner, fillY);
  ctx.lineTo(fillX + fillW, fillY);
  ctx.lineTo(fillX + fillW, fillY + corner);
  ctx.moveTo(fillX, fillY + fillH - corner);
  ctx.lineTo(fillX, fillY + fillH);
  ctx.lineTo(fillX + corner, fillY + fillH);
  ctx.moveTo(fillX + fillW, fillY + fillH - corner);
  ctx.lineTo(fillX + fillW, fillY + fillH);
  ctx.lineTo(fillX + fillW - corner, fillY + fillH);
  ctx.stroke();
  ctx.restore();

  // ==========================================================================
  // 2) R1 polarity — линия mid + бэйдж
  // ==========================================================================
  const polarityPassed = isLong ? candle.close > mid : candle.close < mid;
  drawDashedHLine({
    ctx,
    xFrom: xLeft - 24,
    xTo: xRight + 4,
    y: yMid + 0.5,
    color: COLOR.accent,
  });
  drawBadge({
    ctx,
    x: xLeft - 26,
    y: yMid,
    text: `mid ${formatPrice(mid)}`,
    align: 'right',
    pass: polarityPassed,
  });

  // ==========================================================================
  // 3) R2 totalDelta — бэйдж над/под свечой
  // ==========================================================================
  const deltaPassed = isLong ? candle.delta > 0 : candle.delta < 0;
  const deltaY = isLong ? Math.min(yHigh, yLow) - 18 : Math.max(yHigh, yLow) + 18;
  drawBadge({
    ctx,
    x: xCenter,
    y: deltaY,
    text: `Δ ${candle.delta > 0 ? '+' : ''}${formatVolume(candle.delta)}`,
    align: 'center',
    pass: deltaPassed,
  });

  // ==========================================================================
  // 4) R3 closeVsVpoc — линия VPOC + бэйджи (vpoc и close)
  // ==========================================================================
  const vpocPassed = isLong ? candle.close > candle.vpoc_price : candle.close < candle.vpoc_price;
  drawDashedHLine({
    ctx,
    xFrom: xLeft - 4,
    xTo: xRight + 24,
    y: yVpoc + 0.5,
    color: COLOR.accent,
  });
  drawBadge({
    ctx,
    x: xRight + 26,
    y: yVpoc,
    text: `VPOC ${formatPrice(candle.vpoc_price)}`,
    align: 'left',
    pass: vpocPassed,
  });
  // Бэйдж close — на одной горизонтали как референс, soft-style.
  if (Math.abs(yClose - yVpoc) > 14) {
    drawBadge({
      ctx,
      x: xRight + 26,
      y: yClose,
      text: `close ${formatPrice(candle.close)}`,
      align: 'left',
      pass: vpocPassed,
      soft: true,
    });
  }

  // ==========================================================================
  // 5) R4 absorption — outline на ячейке экстремума + бэйдж delta_at_*
  // ==========================================================================
  const absorptionPassed = isLong ? candle.delta_at_low < 0 : candle.delta_at_high > 0;
  const extremumPrice = isLong ? candle.low : candle.high;
  const extremumDelta = isLong ? candle.delta_at_low : candle.delta_at_high;
  const yExtremum = isLong ? yLow : yHigh;

  if (isFootprint) {
    const tickSize = detectTickSize(candle.clusters);
    const yT = Math.round(priceToY(extremumPrice + tickSize, viewport, metrics));
    const yB = Math.round(priceToY(extremumPrice, viewport, metrics));
    const top = Math.min(yT, yB);
    const h = Math.max(2, Math.abs(yB - yT));
    ctx.save();
    ctx.strokeStyle = absorptionPassed ? COLOR.warn : COLOR.muted;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(xLeft - 1.5, top - 1.5, xRight - xLeft + 3, h + 3);
    ctx.restore();
  } else {
    drawDashedHLine({
      ctx,
      xFrom: xLeft - 24,
      xTo: xRight + 4,
      y: yExtremum + 0.5,
      color: absorptionPassed ? COLOR.warn : COLOR.muted,
    });
  }
  drawBadge({
    ctx,
    x: xLeft - 26,
    y: yExtremum,
    text: `${isLong ? 'Δ@low' : 'Δ@high'} ${extremumDelta > 0 ? '+' : ''}${formatVolume(extremumDelta)}`,
    align: 'right',
    pass: absorptionPassed,
  });

  // ==========================================================================
  // 6) БОНУС: подсветка имбалансов и нуля на экстремуме (только в footprint)
  //    Эти индикаторы не влияют на наличие сигнала — они визуальный «довесок»
  //    для оценки качества входа.
  // ==========================================================================
  if (isFootprint) {
    const tickSize = detectTickSize(candle.clusters);
    const bonusColor = isLong ? COLOR.long : COLOR.short;

    // Точки-маркеры на каждом имбалансе. Рисуем слева от ячейки, чтобы не мешать
    // существующим цифрам "B × A". Размер подбираем под высоту ячейки.
    for (const cellPrice of signal.diagnostics.imbalancePrices) {
      const yT = Math.round(priceToY(cellPrice + tickSize, viewport, metrics));
      const yB = Math.round(priceToY(cellPrice, viewport, metrics));
      const cellMid = (yT + yB) / 2;
      const dotR = Math.min(4, Math.max(2, Math.abs(yB - yT) / 4));
      ctx.save();
      ctx.fillStyle = bonusColor;
      ctx.beginPath();
      ctx.arc(xLeft - 6, cellMid, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Бэйдж "🎯 0×N" / "🎯 N×0" у экстремума, если аукцион исчерпан.
    if (signal.diagnostics.hasZeroAtExtreme) {
      const zeroPrice = isLong ? candle.clusters[0]!.price : candle.clusters[candle.clusters.length - 1]!.price;
      const yZ = Math.round(priceToY(zeroPrice + tickSize / 2, viewport, metrics));
      // Сдвиг: для LONG (low) ставим чуть НИЖЕ, для SHORT (high) — чуть ВЫШЕ,
      // чтобы не накладываться на R4-бэйдж абсорбции слева.
      const yBadge = isLong ? yZ + 18 : yZ - 18;
      drawBadge({
        ctx,
        x: xLeft - 26,
        y: yBadge,
        text: `0 на ${isLong ? 'low' : 'high'} · аукцион исчерпан`,
        align: 'right',
        pass: true,
      });
    }
  }
}

// ============================================================================
// Вспомогательные примитивы рисования
// ============================================================================

interface DashedHLineArgs {
  ctx: CanvasRenderingContext2D;
  xFrom: number;
  xTo: number;
  y: number;
  color: string;
}

function drawDashedHLine({ ctx, xFrom, xTo, y, color }: DashedHLineArgs): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(xFrom, y);
  ctx.lineTo(xTo, y);
  ctx.stroke();
  ctx.restore();
}

interface BadgeArgs {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  text: string;
  align: 'left' | 'center' | 'right';
  pass: boolean;
  soft?: boolean;
}

function drawBadge({ ctx, x, y, text, align, pass, soft = false }: BadgeArgs): void {
  ctx.save();
  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';

  const prefix = pass ? '✓' : '·';
  const fullText = `${prefix} ${text}`;
  const padX = 5;
  const tw = ctx.measureText(fullText).width;
  const bw = tw + padX * 2;
  const bh = 16;

  let bx: number;
  if (align === 'left') bx = x;
  else if (align === 'right') bx = x - bw;
  else bx = x - bw / 2;
  const by = y - bh / 2;

  ctx.fillStyle = COLOR.badgeBg;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = soft ? 'rgba(148, 163, 184, 0.4)' : COLOR.badgeBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

  ctx.fillStyle = pass ? COLOR.accent : COLOR.mutedText;
  ctx.textAlign = 'left';
  ctx.fillText(fullText, bx + padX, y + 0.5);
  ctx.restore();
}

// ============================================================================
// Утилиты форматирования
// ============================================================================

function formatPrice(p: number): string {
  return p.toFixed(2);
}

function formatVolume(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(2);
}
