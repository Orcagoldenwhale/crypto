/**
 * Рендер классических OHLC-свечей на canvas.
 *
 * На Этапе 5 здесь же добавится вилка: при достаточном zoom in
 * на 5m рисовать footprint-кластера вместо обычных свечей.
 */

import { candleDurationMs, candleWidthPx, priceToY, timeToX } from './scale';
import type { CanvasMetrics, Viewport } from './scale';
import type { Candle5m, Candle15m } from '@/types';

const COLORS = {
  up: '#089981',
  down: '#f23645',
  doji: '#9ca3af',
} as const;

/** Свеча для рендера — нужны только OHLC поля */
type RenderableCandle = Pick<Candle5m | Candle15m, 'timestamp' | 'open' | 'high' | 'low' | 'close'>;

export interface RenderCandlesArgs<T extends RenderableCandle> {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  /** Только видимый срез — экономим работу */
  candles: readonly T[];
  startIdx: number;
  endIdx: number;
  timeframe: '1h' | '15m' | '5m';
}

export function renderCandles<T extends RenderableCandle>({
  ctx,
  metrics,
  viewport,
  candles,
  startIdx,
  endIdx,
  timeframe,
}: RenderCandlesArgs<T>): void {
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return;

  const cwPx = candleWidthPx(timeframe, viewport, metrics);
  // Тело свечи занимает 70% слота, фитиль — 1px по центру.
  const bodyWidth = Math.max(1, cwPx * 0.7);
  const candleMs = candleDurationMs(timeframe);

  // Сначала фитили — одной общей строкой по группам цвета (лучше для batching).
  ctx.lineWidth = 1;

  for (const isUp of [true, false]) {
    ctx.strokeStyle = isUp ? COLORS.up : COLORS.down;
    ctx.beginPath();
    for (let i = startIdx; i <= endIdx; i++) {
      const c = candles[i];
      if (!c) continue;
      const candleIsUp = c.close >= c.open;
      if (candleIsUp !== isUp) continue;
      const xCenter = timeToX(c.timestamp + candleMs / 2, viewport, metrics);
      const xRounded = Math.round(xCenter) + 0.5;
      const yHigh = Math.round(priceToY(c.high, viewport, metrics));
      const yLow = Math.round(priceToY(c.low, viewport, metrics));
      ctx.moveTo(xRounded, yHigh);
      ctx.lineTo(xRounded, yLow);
    }
    ctx.stroke();
  }

  // Затем тела — отдельным циклом, fillRect для каждой по цвету.
  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (!c) continue;
    const isUp = c.close >= c.open;
    ctx.fillStyle = isUp ? COLORS.up : COLORS.down;

    const xCenter = timeToX(c.timestamp + candleMs / 2, viewport, metrics);
    const yOpen = priceToY(c.open, viewport, metrics);
    const yClose = priceToY(c.close, viewport, metrics);
    const top = Math.min(yOpen, yClose);
    const bottom = Math.max(yOpen, yClose);
    const height = Math.max(1, bottom - top);

    ctx.fillRect(
      Math.round(xCenter - bodyWidth / 2),
      Math.round(top),
      Math.max(1, Math.round(bodyWidth)),
      Math.round(height),
    );
  }
}
