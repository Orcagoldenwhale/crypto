/**
 * Склеивание исторических 5m с live-хвостом.
 *
 * Типичный кейс: prebuilt JSON заканчивается на том же 5m-слоте, что и «сейчас»
 * (или последняя закрытая свеча совпадает с открытой live по timestamp).
 * Тогда нельзя требовать строго `liveTs > lastHistoryTs` — иначе live никогда
 * не попадёт в массив и цена «замрёт».
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
