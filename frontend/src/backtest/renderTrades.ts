import type { CanvasMetrics, Viewport } from '@/engine/scale';
import { candleDurationMs } from '@/engine/scale';
import type { Timeframe } from '@/types';
import type { BacktestTrade } from './types';
import type { SmcZoneRect } from './runBacktest';

const COLOR_WIN = 'rgba(38, 166, 91, 0.85)';
const COLOR_LOSS = 'rgba(239, 83, 80, 0.85)';
const COLOR_OPEN = 'rgba(255, 193, 7, 0.85)';
const COLOR_ENTRY = '#2196f3';
const COLOR_STOP = 'rgba(239, 83, 80, 0.6)';
const COLOR_TAKE = 'rgba(38, 166, 91, 0.6)';
const COLOR_ZONE_GAP = 'rgba(255, 193, 7, 0.08)';
const COLOR_ZONE_GAP_BORDER = 'rgba(255, 193, 7, 0.25)';

function priceToY(price: number, viewport: Viewport, metrics: CanvasMetrics): number {
  const plotH = metrics.height - metrics.paddingBottom;
  return plotH - ((price - viewport.priceMin) / (viewport.priceMax - viewport.priceMin)) * plotH;
}

function timeToX(ts: number, viewport: Viewport, metrics: CanvasMetrics): number {
  const plotW = metrics.width - metrics.paddingRight;
  return ((ts - viewport.timeStart) / (viewport.timeEnd - viewport.timeStart)) * plotW;
}

export function renderBacktestTrades(opts: {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  trades: readonly BacktestTrade[];
  chartTf: Timeframe;
}): void {
  const { ctx, metrics, viewport, trades, chartTf } = opts;
  const slotMs = candleDurationMs(chartTf);
  const halfSlot = slotMs / 2;

  for (const trade of trades) {
    const entryX = timeToX(trade.entryTime + halfSlot, viewport, metrics);
    const entryY = priceToY(trade.entryPrice, viewport, metrics);
    const stopY = priceToY(trade.stopPrice, viewport, metrics);
    const takeY = priceToY(trade.takePrice, viewport, metrics);

    if (entryX < -50 || entryX > metrics.width + 50) continue;

    const exitX = trade.exitTime
      ? timeToX(trade.exitTime + halfSlot, viewport, metrics)
      : entryX + 60;

    // Stop-loss line
    ctx.save();
    ctx.strokeStyle = COLOR_STOP;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(entryX, stopY);
    ctx.lineTo(Math.max(exitX, entryX + 30), stopY);
    ctx.stroke();
    ctx.restore();

    // Take-profit line
    ctx.save();
    ctx.strokeStyle = COLOR_TAKE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(entryX, takeY);
    ctx.lineTo(Math.max(exitX, entryX + 30), takeY);
    ctx.stroke();
    ctx.restore();

    // Entry → exit connector line
    if (trade.exitTime) {
      const exitY = priceToY(trade.exitPrice!, viewport, metrics);
      ctx.save();
      ctx.strokeStyle = trade.outcome === 'win' ? COLOR_WIN : COLOR_LOSS;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(entryX, entryY);
      ctx.lineTo(exitX, exitY);
      ctx.stroke();
      ctx.restore();
    }

    // Entry marker (diamond)
    ctx.save();
    ctx.fillStyle = COLOR_ENTRY;
    ctx.beginPath();
    ctx.moveTo(entryX, entryY - 5);
    ctx.lineTo(entryX + 4, entryY);
    ctx.lineTo(entryX, entryY + 5);
    ctx.lineTo(entryX - 4, entryY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Exit marker (circle)
    if (trade.exitTime && trade.exitPrice !== null) {
      const exitY = priceToY(trade.exitPrice, viewport, metrics);
      const color =
        trade.outcome === 'win'
          ? COLOR_WIN
          : trade.outcome === 'loss'
            ? COLOR_LOSS
            : COLOR_OPEN;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(exitX, exitY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Labels
    ctx.save();
    ctx.font = '10px monospace';

    // SL label
    ctx.fillStyle = COLOR_STOP;
    ctx.textAlign = 'left';
    ctx.fillText(`SL ${trade.stopPrice.toFixed(1)}`, entryX + 4, stopY - 3);

    // TP label
    ctx.fillStyle = COLOR_TAKE;
    ctx.fillText(`TP ${trade.takePrice.toFixed(1)}`, entryX + 4, takeY - 3);

    // Outcome label
    if (trade.outcome !== 'open') {
      const label = trade.outcome === 'win'
        ? `+${trade.pnlR.toFixed(1)}R`
        : `${trade.pnlR.toFixed(1)}R`;
      ctx.fillStyle = trade.outcome === 'win' ? COLOR_WIN : COLOR_LOSS;
      ctx.fillText(label, entryX + 4, entryY - 8);
    }

    ctx.restore();
  }
}

export function renderBacktestZones(opts: {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  zones: readonly SmcZoneRect[];
}): void {
  const { ctx, metrics, viewport, zones } = opts;

  for (const zone of zones) {
    const x1 = timeToX(zone.startTime, viewport, metrics);
    const x2 = timeToX(zone.endTime, viewport, metrics);
    const y1 = priceToY(zone.maxPrice, viewport, metrics);
    const y2 = priceToY(zone.minPrice, viewport, metrics);

    if (x2 < -50 || x1 > metrics.width + 50) continue;
    if (y1 > metrics.height + 50 || y2 < -50) continue;

    const w = Math.max(x2 - x1, 2);
    const h = Math.max(y2 - y1, 1);

    ctx.save();
    ctx.fillStyle = COLOR_ZONE_GAP;
    ctx.fillRect(x1, y1, w, h);
    ctx.strokeStyle = COLOR_ZONE_GAP_BORDER;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x1, y1, w, h);
    ctx.restore();
  }
}
