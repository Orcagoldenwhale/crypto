/**
 * Hit-test: определение свечи под курсором по координате X.
 *
 * Чистая функция — используется и для подсветки в overlay, и для
 * передачи hovered-свечи в StatusBar. Один источник правды.
 *
 * Алгоритм: переводим x в timestamp через xToTime, потом бинарный поиск
 * последней свечи с timestamp ≤ targetTime (это "контейнер" текущего слота).
 * Если timestamp+duration < targetTime — курсор уже в межсвечном промежутке
 * (пустое окно справа), возвращаем -1.
 *
 * По Y-координате не проверяем — TradingView показывает свечу под курсором
 * даже если он выше high или ниже low, и это удобнее (мышь не теряется).
 */

import { candleDurationMs, xToTime } from './scale';
import type { CanvasMetrics, Viewport } from './scale';
import type { TimestampMs } from '@/types';

interface HasTimestamp {
  timestamp: TimestampMs;
}

/**
 * Возвращает индекс свечи, "закрывающей" координату x.
 * Если такой свечи нет (курсор в пустом окне) — -1.
 */
export function hitTestCandle<T extends HasTimestamp>(
  candles: readonly T[],
  x: number,
  timeframe: '1h' | '15m' | '5m',
  vp: Viewport,
  metrics: CanvasMetrics,
): number {
  if (candles.length === 0) return -1;
  if (x < 0 || x > metrics.width) return -1;

  const t = xToTime(x, vp, metrics);
  const duration = candleDurationMs(timeframe);

  // Бинарный поиск последней свечи с timestamp ≤ t.
  // Без выравнивания на сетку — данные могут начинаться не точно на UTC-границе.
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const c = candles[mid];
    if (c && c.timestamp <= t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo - 1;
  if (idx < 0) return -1;

  const c = candles[idx];
  if (!c) return -1;
  // Если курсор уже за пределами этой свечи (после её закрытия и до начала
  // следующей) — это "пустое окно", свечи под курсором нет.
  if (t > c.timestamp + duration) return -1;
  return idx;
}
