/**
 * Хук-машина состояния для рисования POI-зон.
 *
 * Передаём в него актуальный viewport и метрики, а на выходе получаем:
 *   - draft        — координаты строящейся зоны (или null, если drag не активен)
 *   - onMouseDown  — стартует drag, если инструмент включён
 *   - onMouseMove  — обновляет draft
 *   - onMouseUp    — завершает drag, вызывает onCreate если зона достаточного размера
 *   - cancel       — сбрасывает текущий drag (вешаем на Escape)
 *
 * Почему хук, а не inline-логика в ChartCanvas: drawing — отдельная
 * стейт-машина, её хочется тестировать и переиспользовать (например, для
 * других типов разметки в будущем — линии, fib и т.п.).
 */

import { useCallback, useRef, useState } from 'react';
import type { CanvasMetrics, Viewport } from '@/engine/scale';
import { screenRectToZoneCoords, type DraftZoneCoords } from '@/engine/poi';

/** Минимальный размер зоны на экране, чтобы её НЕ считать случайным кликом. */
const MIN_DRAG_PX = 6;

export interface UsePOIDrawingArgs {
  /** Инструмент активен (tool === 'rectangle') */
  enabled: boolean;
  viewport: Viewport;
  metrics: CanvasMetrics;
  /** Вызывается на mouseUp при валидном размере. */
  onCreate: (coords: DraftZoneCoords) => void;
}

export interface UsePOIDrawingResult {
  draft: DraftZoneCoords | null;
  /** true → событие обработано, во внешнем коде ничего больше делать не надо. */
  onMouseDown: (cssX: number, cssY: number) => boolean;
  onMouseMove: (cssX: number, cssY: number) => boolean;
  onMouseUp: () => boolean;
  cancel: () => void;
}

export function usePOIDrawing({
  enabled,
  viewport,
  metrics,
  onCreate,
}: UsePOIDrawingArgs): UsePOIDrawingResult {
  const [draft, setDraft] = useState<DraftZoneCoords | null>(null);
  const startScreen = useRef<{ x: number; y: number } | null>(null);
  // Источник правды для последнего черновика.
  //
  // ВАЖНО: НИКОГДА не вызываем побочные эффекты (например, onCreate)
  // внутри функционального апдейтера setDraft. В React Strict Mode такой
  // апдейтер вызывается ДВАЖДЫ — что приведёт к двойному созданию зоны.
  // Поэтому актуальный draft держим в ref и читаем его в onMouseUp снаружи.
  const draftRef = useRef<DraftZoneCoords | null>(null);

  const updateDraft = useCallback((next: DraftZoneCoords | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const onMouseDown = useCallback(
    (cssX: number, cssY: number): boolean => {
      if (!enabled) return false;
      // Не начинаем рисовать, если клик за пределами области графика
      // (правая ось цены / нижняя ось времени).
      if (cssX > metrics.width - metrics.paddingRight) return false;
      if (cssY > metrics.height - metrics.paddingBottom) return false;

      startScreen.current = { x: cssX, y: cssY };
      const coords = screenRectToZoneCoords(cssX, cssY, cssX, cssY, viewport, metrics);
      updateDraft(coords);
      return true;
    },
    [enabled, viewport, metrics, updateDraft],
  );

  const onMouseMove = useCallback(
    (cssX: number, cssY: number): boolean => {
      if (!startScreen.current) return false;
      const s = startScreen.current;
      const coords = screenRectToZoneCoords(s.x, s.y, cssX, cssY, viewport, metrics);
      updateDraft(coords);
      return true;
    },
    [viewport, metrics, updateDraft],
  );

  const onMouseUp = useCallback((): boolean => {
    const s = startScreen.current;
    if (!s) return false;
    startScreen.current = null;

    // Берём последний draft из ref ДО его сброса.
    const finalDraft = draftRef.current;
    updateDraft(null);

    if (!finalDraft) return true;

    // Минимальный размер по экрану — отсекаем случайные клики.
    const dt = Math.abs(finalDraft.endTime - finalDraft.startTime);
    const dp = Math.abs(finalDraft.endPrice - finalDraft.startPrice);
    const tRange = viewport.timeEnd - viewport.timeStart;
    const pRange = viewport.priceMax - viewport.priceMin;
    const w = metrics.width - metrics.paddingRight;
    const h = metrics.height - metrics.paddingBottom;
    const pxX = tRange > 0 && w > 0 ? (dt / tRange) * w : 0;
    const pxY = pRange > 0 && h > 0 ? (dp / pRange) * h : 0;
    if (pxX < MIN_DRAG_PX || pxY < MIN_DRAG_PX) return true;

    // Побочный эффект — СНАРУЖИ setDraft. Гарантировано один раз на mouseup.
    onCreate(finalDraft);
    return true;
  }, [onCreate, viewport, metrics, updateDraft]);

  const cancel = useCallback(() => {
    startScreen.current = null;
    updateDraft(null);
  }, [updateDraft]);

  return { draft, onMouseDown, onMouseMove, onMouseUp, cancel };
}
