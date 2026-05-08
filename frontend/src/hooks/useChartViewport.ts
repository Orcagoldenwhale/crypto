/**
 * Хук состояния viewport графика + обработчики Pan/Zoom.
 *
 * Поддерживает:
 *  - Pan мышью (drag),
 *  - Zoom колесом с пивотом под курсором,
 *  - Авто-подгонку priceMin/priceMax под видимые свечи.
 *
 * Цена пересчитывается реактивно при каждом изменении timeStart/timeEnd,
 * а сами обработчики возвращаются стабильными ссылками (useCallback)
 * чтобы не вызывать лишние re-attach у listeners.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findVisibleRange, fitPriceRange, candleDurationMs } from '@/engine/scale';
import type { Viewport } from '@/engine/scale';
import type { Candle5m, Candle15m, Candle1h, Timeframe } from '@/types';

interface HasOhlcAndTime {
  timestamp: number;
  high: number;
  low: number;
}

export interface UseChartViewportArgs {
  candles: readonly (Candle5m | Candle15m | Candle1h)[];
  timeframe: Timeframe;
  /** Сколько свечей показать по умолчанию при первой загрузке */
  defaultVisibleCandles?: number;
}

export interface UseChartViewportResult {
  viewport: Viewport;
  /** Использовать на canvas: возвращает обработчики DOM-событий */
  handlers: {
    onWheel: (e: WheelEvent, canvasWidth: number) => void;
    onMouseDown: (e: MouseEvent) => void;
    onMouseMove: (e: MouseEvent, canvasWidth: number) => void;
    onMouseUp: () => void;
  };
  /** Зафитить viewport на все имеющиеся данные */
  resetView: () => void;
  /** Зафитить viewport на конкретный временной диапазон */
  zoomToTimeRange: (timeStart: number, timeEnd: number) => void;
}

const MIN_VISIBLE_CANDLES = 5;
const DEFAULT_VISIBLE = 100;

export function useChartViewport({
  candles,
  timeframe,
  defaultVisibleCandles = DEFAULT_VISIBLE,
}: UseChartViewportArgs): UseChartViewportResult {
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 1]);
  const candleMs = useMemo(() => candleDurationMs(timeframe), [timeframe]);

  // ---- Инициализация / ресет при смене данных или таймфрейма ----
  //
  // Ключ намеренно НЕ включает `last.timestamp` и `candles.length`.
  // Раньше включал — и в Live-режиме каждый новый тик/новая свеча
  // меняли ключ, авто-fit гнал viewport на «последние 100 свечей»
  // и затирал ручной `zoomToTimeRange` (например, фокус на 24ч после
  // prefetch). Теперь авто-fit срабатывает только при смене таймфрейма
  // ИЛИ при принципиально новом наборе данных (другой `first.timestamp`,
  // например при смене символа / загрузке нового dataset). Доращивание
  // справа (live, mergeRaw5mWithLive) уже не дёргает viewport.
  const lastFitKey = useRef<string>('');
  useEffect(() => {
    if (candles.length === 0) return;
    const first = candles[0];
    const last = candles[candles.length - 1];
    if (!first || !last) return;

    const key = `${timeframe}:${first.timestamp}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;

    const visibleCount = Math.min(defaultVisibleCandles, candles.length);
    const visibleSpan = visibleCount * candleMs;
    const newEnd = last.timestamp + candleMs * 2;
    const newStart = newEnd - visibleSpan;
    setTimeRange([newStart, newEnd]);
  }, [candles, timeframe, candleMs, defaultVisibleCandles]);

  // ---- Цена авто-фитится по видимым свечам ----
  const viewport = useMemo<Viewport>(() => {
    const [tStart, tEnd] = timeRange;
    const [s, e] = findVisibleRange(candles as readonly HasOhlcAndTime[], tStart, tEnd);
    const { priceMin, priceMax } = fitPriceRange(
      candles as readonly HasOhlcAndTime[],
      s,
      e,
      0.05,
    );
    return { timeStart: tStart, timeEnd: tEnd, priceMin, priceMax };
  }, [timeRange, candles]);

  // ---- Pan / Zoom ----
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartTime = useRef<[number, number]>([0, 0]);

  const onWheel = useCallback(
    (e: WheelEvent, canvasWidth: number) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

      setTimeRange(([start, end]) => {
        const range = end - start;
        const pivotTime = start + (mouseX / canvasWidth) * range;
        const newStart = pivotTime - (pivotTime - start) * factor;
        const newEnd = pivotTime + (end - pivotTime) * factor;
        const minRange = MIN_VISIBLE_CANDLES * candleMs;
        if (newEnd - newStart < minRange) return [start, end];
        return [newStart, newEnd];
      });
    },
    [candleMs],
  );

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragStartX.current = e.clientX - rect.left;
    setTimeRange((prev) => {
      dragStartTime.current = prev;
      return prev;
    });
  }, []);

  const onMouseMove = useCallback((e: MouseEvent, canvasWidth: number) => {
    if (!isDragging.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dx = x - dragStartX.current;
    const [origStart, origEnd] = dragStartTime.current;
    const range = origEnd - origStart;
    const shift = (dx / canvasWidth) * range;
    setTimeRange([origStart - shift, origEnd - shift]);
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const resetView = useCallback(() => {
    if (candles.length === 0) return;
    const first = candles[0];
    const last = candles[candles.length - 1];
    if (!first || !last) return;
    const visibleCount = Math.min(defaultVisibleCandles, candles.length);
    const visibleSpan = visibleCount * candleMs;
    const newEnd = last.timestamp + candleMs * 2;
    const newStart = newEnd - visibleSpan;
    setTimeRange([newStart, newEnd]);
  }, [candles, candleMs, defaultVisibleCandles]);

  const zoomToTimeRange = useCallback((timeStart: number, timeEnd: number) => {
    setTimeRange([timeStart, timeEnd]);
  }, []);

  return {
    viewport,
    handlers: { onWheel, onMouseDown, onMouseMove, onMouseUp },
    resetView,
    zoomToTimeRange,
  };
}
