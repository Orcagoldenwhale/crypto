/**
 * Рендер footprint-кластеров (раскрытая 5m-свеча с разбивкой по уровням цен).
 *
 * Работает только с Candle5m (у Candle15m нет clusters).
 * Каждая свеча — это столбик ячеек, в каждой ячейке:
 *   - фон   = heatmap дельты (зелёный/красный, альфа = |delta| / max_vol)
 *   - бар   = горизонтальная полоса объёма vol/max_vol (полупрозрачная белая)
 *   - рамка = жирная белая, если price === vpoc_price; иначе тонкая полупрозрачная
 *   - текст = "bid × ask", подсветка имбалансов 2× жирным цветом
 *
 * Если ячейка слишком низкая — текст пропускаем (не слипается).
 * Если bodyWidth < FOOTPRINT_MIN_WIDTH_PX — рисуем обычные свечи через fallback.
 */

import { candleDurationMs, candleWidthPx, priceToY, timeToX } from './scale';
import type { CanvasMetrics, Viewport } from './scale';
import { renderCandles } from './candles';
import type { Candle5m, Cluster } from '@/types';

// ============================================================================
// Константы
// ============================================================================

/** Минимальная ширина свечи в CSS-пикселях, при которой включается footprint. */
export const FOOTPRINT_MIN_WIDTH_PX = 50;

/** Минимальная высота ячейки для отрисовки текста "B × A". */
const TEXT_MIN_CELL_HEIGHT_PX = 12;

/** Множитель имбаланса (>= 2× — подсветка). */
const IMBALANCE_RATIO = 2;

/** Tick size; берём из первого зазора между ценами кластеров на лету. */
function detectTickSize(clusters: Candle5m['clusters']): number {
  if (clusters.length < 2) return 0;
  const a = clusters[0]?.price;
  const b = clusters[1]?.price;
  if (a === undefined || b === undefined) return 0;
  return Math.max(0, b - a);
}

/**
 * Адаптивный формат объёма для подписей в ячейках кластеров.
 *
 * Объёмы на одном ценовом уровне в BTC бывают крошечными (0.1–0.5),
 * средними (1–10) и большими (десятки). Просто `Math.round` теряет
 * информацию для маленьких — превращает «0.5» в «0» или «1».
 *
 * Делаем число знаков адаптивным:
 *   v == 0           → "0"
 *   v < 1            → "0.42"   (две десятичные)
 *   v < 10           → "3.5"    (одна десятичная)
 *   v < 1000         → "127"    (целое)
 *   v ≥ 1000         → "1.2k"   (компактно)
 *
 * Экспортируется для unit-тестов.
 */
export function formatClusterVol(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  if (v < 1) return v.toFixed(2);
  if (v < 10) return v.toFixed(1);
  if (v < 1000) return Math.round(v).toString();
  return (v / 1000).toFixed(1) + 'k';
}

// ============================================================================
// Цвета
// ============================================================================

const COLOR = {
  up: '#089981',
  down: '#f23645',
  wick: 'rgba(156, 163, 175, 0.45)',
  cellBorder: 'rgba(255, 255, 255, 0.06)',
  vpocBorder: '#ffffff',
  volBar: 'rgba(255, 255, 255, 0.18)',
  textNormal: '#cbd5e1',
  textDim: '#475569',
  textBidImb: '#ff6b6b',
  textAskImb: '#4ade80',
} as const;

// ============================================================================
// Публичный API
// ============================================================================

export interface RenderFootprintArgs {
  ctx: CanvasRenderingContext2D;
  metrics: CanvasMetrics;
  viewport: Viewport;
  candles: readonly Candle5m[];
  /** 5m или 15m LTF — от этого зависит ширина слота и центр свечи по времени. */
  chartTf: '15m' | '5m';
  startIdx: number;
  endIdx: number;
}

/**
 * Решает, рисовать ли footprint при текущем zoom.
 * Используется ChartCanvas, чтобы выбрать между classical и footprint.
 */
/**
 * Footprint включается только на младших ТФ (5m / 15m) с кластерами.
 * 1h — только классические свечи.
 */
export function shouldRenderFootprint(
  chartTf: '1h' | '15m' | '5m',
  vp: Viewport,
  metrics: CanvasMetrics,
): boolean {
  if (chartTf === '1h') return false;
  return candleWidthPx(chartTf, vp, metrics) >= FOOTPRINT_MIN_WIDTH_PX;
}

// ============================================================================
// Hit-test ячеек кластеров — нужен для тултипа и hover-подсветки
// ============================================================================

/**
 * Прямоугольник одной ячейки кластера на canvas.
 *
 * Содержит ссылку на сам кластер (для тултипа) и timestamp свечи —
 * чтобы по hitbox можно было поднять связанные данные без повторного hit-test.
 */
export interface ClusterHitbox {
  candleTimestamp: number;
  cluster: Cluster;
  /** Индекс свечи в массиве — для быстрой подсветки родительской свечи. */
  candleIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Возвращает все видимые на экране ячейки кластеров.
 *
 * Геометрия идентична `renderFootprint` — это критично:
 *   рисуем и хитим по ОДНИМ И ТЕМ ЖЕ координатам.
 * Любое расхождение → курсор промахивается.
 *
 * Зов дороговатый (O(visible_candles × clusters_per_candle)), поэтому в
 * ChartCanvas он мемоизирован по viewport+metrics+candles.
 */
export function computeClusterHitboxes(
  candles: readonly Candle5m[],
  startIdx: number,
  endIdx: number,
  vp: Viewport,
  metrics: CanvasMetrics,
  chartTf: '15m' | '5m',
): ClusterHitbox[] {
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return [];

  const result: ClusterHitbox[] = [];
  const cwPx = candleWidthPx(chartTf, vp, metrics);
  const cellWidthPx = cwPx * 0.9;
  const candleMs = candleDurationMs(chartTf);

  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (!c) continue;
    if (!c.clusters || c.clusters.length < 2 || c.max_vol <= 0) continue;

    const xCenter = timeToX(c.timestamp + candleMs / 2, vp, metrics);
    const xLeft = Math.round(xCenter - cellWidthPx / 2);
    const cellW = Math.max(2, Math.round(cellWidthPx));

    const tickSize = detectTickSize(c.clusters);

    for (const cluster of c.clusters) {
      const yTop = priceToY(cluster.price + tickSize, vp, metrics);
      const yBottom = priceToY(cluster.price, vp, metrics);
      const yT = Math.round(Math.min(yTop, yBottom));
      const yB = Math.round(Math.max(yTop, yBottom));
      const cellH = Math.max(1, yB - yT);
      if (cellH < 1) continue;

      result.push({
        candleTimestamp: c.timestamp,
        cluster,
        candleIndex: i,
        x: xLeft,
        y: yT,
        w: cellW,
        h: cellH,
      });
    }
  }
  return result;
}

/** Возвращает первый кластер под (x, y) или null. */
export function hitTestCluster(
  hitboxes: readonly ClusterHitbox[],
  x: number,
  y: number,
): ClusterHitbox | null {
  // Хитбоксы кластеров не пересекаются (одна сетка), поэтому достаточно линейного прохода.
  for (const h of hitboxes) {
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
      return h;
    }
  }
  return null;
}

/**
 * Лёгкая подсветка ячейки кластера под курсором.
 * Вызывается на overlay-canvas каждый mousemove.
 */
export function renderClusterHover(
  ctx: CanvasRenderingContext2D,
  hb: ClusterHitbox,
): void {
  ctx.save();
  ctx.strokeStyle = '#7dd3fc'; // голубой — отличается и от золотого (selected), и от белого (VPOC)
  ctx.lineWidth = 2;
  ctx.strokeRect(hb.x + 1, hb.y + 1, hb.w - 2, hb.h - 2);
  ctx.restore();
}

/**
 * Рендер всех видимых свечей в footprint-режиме.
 * Если у свечи нет clusters / max_vol — деградируем до обычной OHLC-свечи.
 */
export function renderFootprint({
  ctx,
  metrics,
  viewport,
  candles,
  chartTf,
  startIdx,
  endIdx,
}: RenderFootprintArgs): void {
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return;

  const cwPx = candleWidthPx(chartTf, viewport, metrics);
  const cellWidthPx = cwPx * 0.9;
  const candleMs = candleDurationMs(chartTf);

  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (!c) continue;

    // Свечи с пустыми / одним кластером (синтез из Binance klines) —
    // будут отрисованы как обычные OHLC через fallback в конце.
    if (!c.clusters || c.clusters.length < 2 || c.max_vol <= 0) continue;

    const xCenter = timeToX(c.timestamp + candleMs / 2, viewport, metrics);
    const xLeft = Math.round(xCenter - cellWidthPx / 2);
    const cellW = Math.max(2, Math.round(cellWidthPx));

    // Тонкая центральная линия high-low — даёт визуально форму свечи.
    const isUp = c.close >= c.open;
    const yHighLine = Math.round(priceToY(c.high, viewport, metrics)) + 0.5;
    const yLowLine = Math.round(priceToY(c.low, viewport, metrics)) + 0.5;
    ctx.strokeStyle = isUp ? COLOR.up : COLOR.down;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const xMid = Math.round(xCenter) + 0.5;
    ctx.moveTo(xMid, yHighLine);
    ctx.lineTo(xMid, yLowLine);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const tickSize = detectTickSize(c.clusters);

    // Перебираем кластеры. Каждый занимает диапазон [price, price + tickSize).
    for (const cluster of c.clusters) {
      const yTop = priceToY(cluster.price + tickSize, viewport, metrics);
      const yBottom = priceToY(cluster.price, viewport, metrics);
      const yT = Math.round(Math.min(yTop, yBottom));
      const yB = Math.round(Math.max(yTop, yBottom));
      const cellH = Math.max(1, yB - yT);

      // Невидимо тонкие ячейки — пропуск.
      if (cellH < 1) continue;

      // 1) Heatmap дельты
      if (cluster.delta !== 0) {
        const intensity = Math.min(Math.abs(cluster.delta) / c.max_vol, 0.5);
        ctx.fillStyle =
          cluster.delta > 0
            ? `rgba(8, 153, 129, ${intensity.toFixed(3)})`
            : `rgba(242, 54, 69, ${intensity.toFixed(3)})`;
        ctx.fillRect(xLeft, yT, cellW, cellH);
      }

      // 2) Гистограмма объёма
      const volFrac = c.max_vol > 0 ? cluster.vol / c.max_vol : 0;
      if (volFrac > 0) {
        const barW = Math.max(1, Math.round(cellW * volFrac));
        ctx.fillStyle = COLOR.volBar;
        ctx.fillRect(xLeft, yT, barW, cellH);
      }

      // 3) Рамка ячейки + VPOC-выделение
      const isVpoc = cluster.price === c.vpoc_price;
      ctx.strokeStyle = isVpoc ? COLOR.vpocBorder : COLOR.cellBorder;
      ctx.lineWidth = isVpoc ? 1.5 : 0.5;
      ctx.strokeRect(xLeft + 0.5, yT + 0.5, cellW - 1, cellH - 1);

      // 4) Текст "bid × ask" с имбалансами.
      //    Минимальная ширина 48px — хватает на пару дробных значений
      //    типа "0.42 × 0.18" с разделителем ' × '.
      if (cellH >= TEXT_MIN_CELL_HEIGHT_PX && cellW >= 48) {
        const yMid = yT + cellH / 2;
        const bidStr = formatClusterVol(cluster.bid);
        const askStr = formatClusterVol(cluster.ask);
        const sepStr = ' × ';

        const bidImb = cluster.bid > cluster.ask * IMBALANCE_RATIO;
        const askImb = cluster.ask > cluster.bid * IMBALANCE_RATIO;

        // Меряем ширину текстовых сегментов, чтобы выровнять: [bid] [×] [ask]
        const wBid = ctx.measureText(bidStr).width;
        const wSep = ctx.measureText(sepStr).width;
        const wAsk = ctx.measureText(askStr).width;
        const totalW = wBid + wSep + wAsk;

        const startX = xCenter - totalW / 2;

        // bid
        ctx.fillStyle = bidImb ? COLOR.textBidImb : COLOR.textNormal;
        ctx.font = `${bidImb ? '700 ' : ''}10px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'left';
        ctx.fillText(bidStr, startX, yMid);

        // ×
        ctx.fillStyle = COLOR.textDim;
        ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText(sepStr, startX + wBid, yMid);

        // ask
        ctx.fillStyle = askImb ? COLOR.textAskImb : COLOR.textNormal;
        ctx.font = `${askImb ? '700 ' : ''}10px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillText(askStr, startX + wBid + wSep, yMid);

        // Возвращаем выравнивание
        ctx.textAlign = 'center';
      }
    }
  }

  // Свечи без полноценных кластеров (Binance-синтез / одиночный уровень) —
  // fallback на обычный рендер. Делаем это после, чтобы они не «съедали»
  // фон footprint-ячеек у соседних.
  const fallback: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    if (!c) continue;
    if (!c.clusters || c.clusters.length < 2 || c.max_vol <= 0) fallback.push(i);
  }
  if (fallback.length > 0) {
    // У renderCandles нет режима «выборочный список» — но у нас компактные индексы;
    // пройдёмся подряд и просто обойдёмся одним общим вызовом, если все непрерывные.
    // В худшем случае рисуем по одному.
    for (const idx of fallback) {
      renderCandles({
        ctx,
        metrics,
        viewport,
        candles,
        startIdx: idx,
        endIdx: idx,
        timeframe: chartTf,
      });
    }
  }
}
