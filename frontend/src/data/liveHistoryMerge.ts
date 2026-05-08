/**
 * Склеивание исторических 5m с live-хвостом и REST-klines.
 *
 * Здесь две разные функции с разной семантикой:
 *
 *   • `mergeRaw5mWithLive` — для WS-live-данных. Отбрасывает свечи без
 *     кластеров (пустой open-candle до первого тика, пустые промежуточные
 *     состояния), чтобы они не затирали историю с реальными кластерами.
 *
 *   • `mergeRaw5mWithKlines` — для REST `/klines` prefetch (последние 24ч).
 *     Эти свечи ВСЕГДА без кластеров (footprint REST не отдаёт), и фильтр
 *     по `clusters.length === 0` для них губителен — он выбрасывает все 287
 *     prefetched-свечей, оставляя на графике только prebuilt-историю
 *     7-дневной давности и одинокую live-свечу справа.
 *
 *     Логика: дедуп по `timestamp`, history побеждает (у неё кластеры
 *     prebuilt-датасета — терять их нельзя), сортировка ASC.
 */

import type { Candle5m } from '@/types';

export function mergeRaw5mWithLive(
  history: readonly Candle5m[],
  liveClosed: readonly Candle5m[],
  liveOpen: Candle5m | null,
): Candle5m[] {
  const hasOpen = liveOpen !== null && liveOpen.clusters.length > 0;
  if (liveClosed.length === 0 && !hasOpen) {
    return history as Candle5m[];
  }

  const out = history.slice();
  let lastTs = out.length > 0 ? out[out.length - 1]!.timestamp : -1;

  const apply = (c: Candle5m) => {
    if (c.clusters.length === 0) return;
    if (c.timestamp > lastTs) {
      out.push(c);
      lastTs = c.timestamp;
    } else if (c.timestamp === lastTs && out.length > 0) {
      out[out.length - 1] = c;
    }
    // c.timestamp < lastTs — устаревший хвост из IDB / артефакт, игнорируем.
  };

  for (const c of liveClosed) apply(c);
  if (liveOpen) apply(liveOpen);

  return out;
}

/**
 * Склеить prebuilt/исторические 5m-свечи с REST-klines (последние 24ч).
 *
 * Контракт:
 *  • Обе стороны могут быть пусты.
 *  • На совпадающих timestamp — побеждает `history` (потому что у неё уже
 *    есть кластеры prebuilt-датасета; klines их не отдаёт).
 *  • Результат отсортирован по timestamp ASC.
 *  • Свечи без кластеров НЕ отбрасываются — это и есть основной use-case.
 */
export function mergeRaw5mWithKlines(
  history: readonly Candle5m[],
  klines: readonly Candle5m[],
): Candle5m[] {
  if (klines.length === 0) return history as Candle5m[];

  const map = new Map<number, Candle5m>();
  for (const c of klines) map.set(c.timestamp, c);
  for (const c of history) map.set(c.timestamp, c);

  const merged = Array.from(map.values());
  merged.sort((a, b) => a.timestamp - b.timestamp);
  return merged;
}
