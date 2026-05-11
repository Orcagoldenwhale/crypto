/**
 * Главный компонент области графика.
 *
 * Архитектура — два <canvas> наложенных друг на друга:
 *   1. main    — фон, сетка, оси, POI-зоны, свечи (тяжёлый, rAF, при изменении viewport/zones)
 *   2. overlay — crosshair, draft-зона при рисовании (лёгкий, на каждый mousemove)
 *
 * HiDPI: внутренний размер canvas умножается на devicePixelRatio,
 * а context масштабируется на DPR один раз → текст и линии чёткие на Retina.
 *
 * Поведение мыши зависит от инструмента (`tool`):
 *   - 'pointer'   → drag = pan, click по зоне = onZoneClick(zone, x, y)
 *   - 'rectangle' → drag = создание новой POI-зоны, отдаём через onCreateZone
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findVisibleRange, type CanvasMetrics } from '@/engine/scale';
import { renderGrid, renderCrosshairAxisLabels } from '@/engine/grid';
import { renderCandles } from '@/engine/candles';
import { renderCrosshair } from '@/engine/crosshair';
import {
  renderFootprint,
  shouldRenderFootprint,
  computeClusterHitboxes,
  hitTestCluster,
  renderClusterHover,
  type ClusterHitbox,
} from '@/engine/footprint';
import {
  renderPOIs,
  renderDraftZone,
  hitTestZones,
  type DraftZoneCoords,
} from '@/engine/poi';
import {
  renderSignals,
  computeSignalHitboxes,
  hitTestSignals,
} from '@/engine/signals';
import { renderSignalHighlight } from '@/engine/highlights';
import { hitTestCandle } from '@/engine/hitTest';
import { renderSmcOverlay } from '@/engine/smc/render';
import type { SmcOverlay } from '@/engine/smc/types';
import { renderBacktestTrades, renderBacktestZones } from '@/backtest/renderTrades';
import type { BacktestTrade } from '@/backtest/types';
import type { SmcZoneRect } from '@/backtest/runBacktest';
import { useChartViewport } from '@/hooks/useChartViewport';
import { usePOIDrawing } from '@/hooks/usePOIDrawing';
import type { Candle5m, Candle15m, Candle1h, POIZone, Signal, Timeframe } from '@/types';
import type { Tool } from '@/components/Toolbox';

const PADDING_RIGHT = 64;
const PADDING_BOTTOM = 24;

interface ChartCanvasProps {
  data: readonly (Candle5m | Candle15m | Candle1h)[];
  /** Таймфрейм текущего графика (ось, свечи, hit-test по слоту). */
  chartTf: Timeframe;
  /**
   * Роль экрана:
   *   'htf'    — только разметка зон (без footprint и маркеров),
   *   'ltf'    — сканер: маркеры, footprint, подсветка сигналов,
   *   'single' — оба поведения одновременно (один таймфрейм на всё).
   */
  chartRole: 'htf' | 'ltf' | 'single';
  /**
   * Таймфрейм слота для маркеров сигналов и подсветки.
   *
   * Используется на экранах 'ltf' и 'single'. На 'htf' — игнорируется.
   * 1h допускается для single-режима '1h-1h'.
   */
  ltfChartTf: Timeframe;
  tool: Tool;
  zones: readonly POIZone[];
  selectedZoneId: string | null;
  signals: readonly Signal[];
  /** ID выбранного сигнала (приходит из App, синхронизирован с TradeDetailPanel). */
  selectedSignalId: string | null;
  onCreateZone: (coords: DraftZoneCoords) => void;
  onZoneClick: (zone: POIZone, screenX: number, screenY: number) => void;
  onClickEmpty: () => void;
  /** Клик по маркеру сигнала на LTF → выбираем этот сигнал. */
  onSelectSignal: (signalId: string) => void;
  /**
   * SMC-overlay (FVG, ликвидность). Рендерится только при htfBehaviour
   * (HTF в двухуровневой паре или single-режим). На LTF в двухуровневой
   * паре игнорируется — там фокус на маркерах сигналов и footprint.
   */
  smcOverlay?: SmcOverlay;
  /** Свеча под курсором — для StatusBar (передаём наружу). */
  onHoverCandle?: (candle: Candle5m | Candle15m | Candle1h | null) => void;
  /** Кластер под курсором — для тултипа (рендерится в App). */
  onHoverCluster?: (info: HoveredClusterInfo | null) => void;
  /** Передаём наружу handle ресета вьюпорта и зума, чтобы App мог переходить HTF↔LTF */
  onViewportApi?: (api: ChartViewportApi) => void;
  /** Сделки бэктеста для визуализации на графике. */
  backtestTrades: readonly BacktestTrade[];
  /** Расширенные зоны бэктеста (с gap). */
  backtestZones: readonly SmcZoneRect[];
}

export interface HoveredClusterInfo {
  hitbox: ClusterHitbox;
  /** Координаты курсора в viewport — для позиционирования тултипа. */
  clientX: number;
  clientY: number;
}

export interface ChartViewportApi {
  resetView: () => void;
  zoomToTimeRange: (timeStart: number, timeEnd: number) => void;
}

export function ChartCanvas({
  data,
  chartTf,
  chartRole,
  ltfChartTf,
  tool,
  zones,
  selectedZoneId,
  signals,
  selectedSignalId,
  onCreateZone,
  onZoneClick,
  onClickEmpty,
  onSelectSignal,
  smcOverlay,
  onHoverCandle,
  onHoverCluster,
  onViewportApi,
  backtestTrades,
  backtestZones,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [metrics, setMetrics] = useState<CanvasMetrics>({
    width: 0,
    height: 0,
    paddingRight: PADDING_RIGHT,
    paddingBottom: PADDING_BOTTOM,
  });

  const { viewport, handlers, resetView, zoomToTimeRange } = useChartViewport({
    candles: data,
    timeframe: chartTf,
  });

  // Прокидываем API наружу один раз и при изменении функций зума/ресета
  useEffect(() => {
    if (onViewportApi) onViewportApi({ resetView, zoomToTimeRange });
  }, [onViewportApi, resetView, zoomToTimeRange]);

  // ============================================================================
  // Hover-стейт сигналов: где находится курсор + какой signalId под ним.
  // Хранится в state, потому что меняет курсор и требует перерисовки overlay.
  // ============================================================================
  const [hoveredSignalId, setHoveredSignalId] = useState<string | null>(null);
  /** Хитбокс кластера под курсором — для подсветки в overlay. */
  const [hoveredCluster, setHoveredCluster] = useState<ClusterHitbox | null>(null);

  /**
   * Поведение экрана включает «LTF-функции» (маркеры/footprint), если
   * это либо чистый LTF, либо single-режим (тогда экран один на всё).
   */
  const ltfBehaviour = chartRole === 'ltf' || chartRole === 'single';

  /**
   * В данных есть хоть одна свеча с реальными кластерами?
   *
   * Идём с конца массива до первого hit'а: live-open и закрытые live-свечи
   * (которые НЕСУТ кластеры) обычно находятся в последних позициях. В типичном
   * use-case это O(1).
   *
   * Раньше тут проверялась только `data[0]` — и если массив начинался с REST-
   * prefetched klines (24ч без кластеров), footprint никогда не включался,
   * даже когда живые свечи с кластерами уже накопились в хвосте. Это ломало
   * LTF/Single для пользователей, включавших Live без prebuilt-истории.
   */
  const dataHasClusters = useMemo(() => {
    for (let i = data.length - 1; i >= 0; i--) {
      const c = data[i] as Partial<Candle5m>;
      if (Array.isArray(c.clusters) && c.clusters.length > 0) return true;
    }
    return false;
  }, [data]);

  // Хитбоксы сигналов — пересчитываются при изменении viewport / signals / metrics.
  const signalHitboxes = useMemo(
    () =>
      ltfBehaviour
        ? computeSignalHitboxes(signals, viewport, metrics, ltfChartTf)
        : [],
    [ltfBehaviour, signals, viewport, metrics, ltfChartTf],
  );

  // Хитбоксы кластеров — там, где включается footprint и есть кластеры.
  const clusterHitboxes = useMemo<ClusterHitbox[]>(() => {
    if (!ltfBehaviour) return [];
    if (!dataHasClusters) return [];
    if (!shouldRenderFootprint(chartTf, viewport, metrics)) return [];
    const [s, e] = findVisibleRange(data, viewport.timeStart, viewport.timeEnd);
    if (s < 0 || e < 0) return [];
    return computeClusterHitboxes(
      data as readonly Candle5m[],
      s,
      e,
      viewport,
      metrics,
      chartTf,
    );
  }, [ltfBehaviour, dataHasClusters, data, chartTf, viewport, metrics]);

  // Если выбранного / наведённого сигнала больше нет в списке — снять стейт.
  // Это защита от рассинхронизации, например после повторного прогона сканера.
  useEffect(() => {
    if (hoveredSignalId && !signals.some((s) => s.id === hoveredSignalId)) {
      setHoveredSignalId(null);
    }
  }, [signals, hoveredSignalId]);

  // Любая смена viewport/timeframe инвалидирует старый hovered-cluster
  // (его координаты больше не соответствуют пикселям). Снимаем хвост наружу.
  useEffect(() => {
    setHoveredCluster(null);
    onHoverCluster?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, chartTf]);

  // Свеча, на которой стоит выбранный сигнал — нужна для подсветки.
  const selectedSignalCandle = useMemo<Candle5m | null>(() => {
    if (!selectedSignalId || !ltfBehaviour) return null;
    const sig = signals.find((s) => s.id === selectedSignalId);
    if (!sig) return null;
    const candle = (data as readonly Candle5m[]).find((c) => c.timestamp === sig.candleTime);
    return candle ?? null;
  }, [selectedSignalId, signals, ltfBehaviour, data]);

  const selectedSignal = useMemo<Signal | null>(() => {
    if (!selectedSignalId) return null;
    return signals.find((s) => s.id === selectedSignalId) ?? null;
  }, [selectedSignalId, signals]);

  // Drawing-машина для POI
  /** Рисование зон разрешено там, где есть HTF-поведение. */
  const htfBehaviour = chartRole === 'htf' || chartRole === 'single';
  const drawing = usePOIDrawing({
    enabled: tool === 'rectangle' && htfBehaviour,
    viewport,
    metrics,
    onCreate: onCreateZone,
  });

  // ============================================================================
  // 1) ResizeObserver + установка реальных размеров canvas с учётом DPR
  // ============================================================================
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(0, Math.floor(rect.width));
      const h = Math.max(0, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;

      for (const ref of [mainCanvasRef, overlayCanvasRef]) {
        const canvas = ref.current;
        if (!canvas) continue;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      setMetrics((prev) => ({ ...prev, width: w, height: h }));
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener('resize', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  // ============================================================================
  // 2) Тяжёлый рендер (свечи, сетка, оси, POI) — через rAF
  // ============================================================================
  const rafIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      const canvas = mainCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (metrics.width === 0 || metrics.height === 0) return;

      renderGrid({ ctx, metrics, viewport });

      // POI: зоны рисуем и на СТ, и на МЛ (на МЛ — контекст вокруг входа).
      if (zones.length > 0) {
        renderPOIs({ ctx, metrics, viewport, zones, selectedZoneId });
      }

      if (data.length === 0) return;

      const [s, e] = findVisibleRange(data, viewport.timeStart, viewport.timeEnd);
      if (s < 0 || e < 0) return;

      // Footprint доступен там, где экран ведёт себя как LTF (или single)
      // И в данных есть реальные кластеры (HTF-OHLCV их не несёт).
      const useFootprint =
        ltfBehaviour &&
        dataHasClusters &&
        shouldRenderFootprint(chartTf, viewport, metrics);

      if (useFootprint) {
        renderFootprint({
          ctx,
          metrics,
          viewport,
          candles: data as readonly Candle5m[],
          chartTf,
          startIdx: s,
          endIdx: e,
        });
      } else {
        renderCandles({
          ctx,
          metrics,
          viewport,
          candles: data,
          startIdx: s,
          endIdx: e,
          timeframe: chartTf,
        });
      }

      // SMC-оверлей (FVG, ликвидность) — только при HTF-поведении.
      // Рисуем ПОСЛЕ свечей, но ДО маркеров сигналов/подсветки, чтобы
      // зоны не закрывали интерактивные элементы.
      if (htfBehaviour && smcOverlay) {
        renderSmcOverlay({ ctx, metrics, viewport, overlay: smcOverlay });
      }

      // Подсветка условий выбранного сигнала — только при LTF-поведении.
      if (ltfBehaviour && selectedSignal && selectedSignalCandle) {
        renderSignalHighlight({
          ctx,
          metrics,
          viewport,
          candle: selectedSignalCandle,
          signal: selectedSignal,
          chartTf: ltfChartTf,
        });
      }

      // Маркеры сигналов — только при LTF-поведении.
      if (ltfBehaviour && signals.length > 0) {
        renderSignals({
          ctx,
          metrics,
          viewport,
          signals,
          ltfChartTf,
          hoveredSignalId,
          selectedSignalId,
        });
      }

      // Бэктест: зоны с gap и сделки (entry/stop/take).
      if (backtestZones && backtestZones.length > 0) {
        renderBacktestZones({ ctx, metrics, viewport, zones: backtestZones });
      }
      if (backtestTrades && backtestTrades.length > 0) {
        renderBacktestTrades({ ctx, metrics, viewport, trades: backtestTrades, chartTf });
      }
    });
    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [
    data,
    chartTf,
    chartRole,
    ltfBehaviour,
    dataHasClusters,
    ltfChartTf,
    viewport,
    metrics,
    zones,
    selectedZoneId,
    signals,
    hoveredSignalId,
    selectedSignalId,
    selectedSignal,
    selectedSignalCandle,
    htfBehaviour,
    smcOverlay,
    backtestTrades,
    backtestZones,
  ]);

  // ============================================================================
  // 3) Overlay (crosshair + draft-зона) — на каждый mousemove
  // ============================================================================
  const cursorRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });

  const drawOverlay = () => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (metrics.width === 0 || metrics.height === 0) return;

    // renderCrosshair сам делает clearRect всего overlay
    const { x, y } = cursorRef.current;
    renderCrosshair({ ctx, metrics, cursorX: x, cursorY: y });

    // Подсветка hovered-кластера — поверх crosshair, но без overlay-текста.
    if (hoveredCluster) {
      renderClusterHover(ctx, hoveredCluster);
    }

    // Draft-зона поверх crosshair
    renderDraftZone({ ctx, metrics, viewport, draft: drawing.draft });

    if (x !== null && y !== null) {
      renderCrosshairAxisLabels({
        ctx,
        metrics,
        viewport,
        cursorX: x,
        cursorY: y,
      });
    }
  };

  // Перерисовать overlay при изменении viewport / метрик / draft / hover
  useEffect(() => {
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, metrics, drawing.draft, hoveredCluster]);

  // ============================================================================
  // 4) Mouse-handlers
  // ============================================================================
  const onMouseDownCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tool === 'rectangle') {
      const handled = drawing.onMouseDown(x, y);
      if (handled) return;
    }

    if (tool === 'pointer') {
      // Приоритет 1 — маркер сигнала (только если есть LTF-поведение).
      if (ltfBehaviour && signalHitboxes.length > 0) {
        const sigId = hitTestSignals(signalHitboxes, x, y);
        if (sigId) {
          onSelectSignal(sigId);
          return;
        }
      }
      // Приоритет 2 — зона (только если есть HTF-поведение).
      if (htfBehaviour) {
        const hit = hitTestZones(zones, x, y, viewport, metrics);
        if (hit) {
          onZoneClick(hit, e.clientX, e.clientY);
          return;
        }
      }
      // Клик мимо: снять выбор зоны/сигнала.
      onClickEmpty();
    }

    // pointer + пустота → pan
    handlers.onMouseDown(e.nativeEvent);
  };

  const onMouseMoveCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cursorRef.current = { x, y };

    if (tool === 'rectangle' && drawing.draft) {
      drawing.onMouseMove(x, y);
    }

    // Hover по маркерам — там, где они вообще рисуются (LTF или single).
    if (tool === 'pointer' && ltfBehaviour && signalHitboxes.length > 0) {
      const sigId = hitTestSignals(signalHitboxes, x, y);
      if (sigId !== hoveredSignalId) setHoveredSignalId(sigId);
    } else if (hoveredSignalId !== null) {
      setHoveredSignalId(null);
    }

    // Hover по кластеру — только в footprint-режиме (массив пустой иначе).
    if (clusterHitboxes.length > 0) {
      const hb = hitTestCluster(clusterHitboxes, x, y);
      if (hb !== hoveredCluster) {
        setHoveredCluster(hb);
        if (onHoverCluster) {
          onHoverCluster(hb ? { hitbox: hb, clientX: e.clientX, clientY: e.clientY } : null);
        }
      } else if (hb && onHoverCluster) {
        // Курсор не сменил ячейку, но всё равно двигается — обновляем координаты тултипа.
        onHoverCluster({ hitbox: hb, clientX: e.clientX, clientY: e.clientY });
      }
    } else if (hoveredCluster !== null) {
      setHoveredCluster(null);
      onHoverCluster?.(null);
    }

    // Hover-свеча — для StatusBar. Считается всегда, на любом таймфрейме.
    if (onHoverCandle) {
      const idx = hitTestCandle(data, x, chartTf, viewport, metrics);
      onHoverCandle(idx >= 0 ? data[idx] ?? null : null);
    }

    drawOverlay();
    handlers.onMouseMove(e.nativeEvent, metrics.width);
  };

  const onMouseUpCanvas = () => {
    if (tool === 'rectangle') {
      const handled = drawing.onMouseUp();
      if (handled) return;
    }
    handlers.onMouseUp();
  };

  const onMouseLeaveCanvas = () => {
    cursorRef.current = { x: null, y: null };
    if (hoveredSignalId !== null) setHoveredSignalId(null);
    if (hoveredCluster !== null) {
      setHoveredCluster(null);
      onHoverCluster?.(null);
    }
    onHoverCandle?.(null);
    drawOverlay();
    handlers.onMouseUp();
    drawing.onMouseUp();
  };

  // ============================================================================
  // 5) Wheel слушатель — нативный non-passive
  // ============================================================================
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      handlers.onWheel(e, metrics.width);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [handlers, metrics.width]);

  // ============================================================================
  // 6) Курсор зависит от инструмента и hover-цели
  // ============================================================================
  const cursorClass =
    tool === 'rectangle'
      ? 'cursor-crosshair'
      : hoveredSignalId
        ? 'cursor-pointer'
        : 'cursor-default';

  // ============================================================================
  // Рендер
  // ============================================================================
  const hasData = data.length > 0;

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 select-none bg-tv-bg-deep ${cursorClass}`}
      onMouseDown={onMouseDownCanvas}
      onMouseMove={onMouseMoveCanvas}
      onMouseUp={onMouseUpCanvas}
      onMouseLeave={onMouseLeaveCanvas}
    >
      <canvas ref={mainCanvasRef} className="absolute top-0 left-0" aria-hidden="true" />
      <canvas
        ref={overlayCanvasRef}
        className="pointer-events-none absolute top-0 left-0"
        aria-hidden="true"
      />

      {!hasData && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-tv-text-muted">
          <div className="text-center">
            <p className="font-mono text-sm">
              Нажмите{' '}
              <span className="rounded border border-tv-border bg-tv-panel px-1.5 py-0.5 text-tv-text">
                Загрузить историю
              </span>{' '}
              в правом верхнем углу
            </p>
            <p className="mt-2 text-xs text-tv-text-muted/70">
              Источник: Binance REST API · 5 дней
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
