/**
 * Удаление дублей POI-зон.
 *
 * Контекст: до 1.11.1 в `usePOIDrawing` побочный эффект `onCreate` вызывался
 * внутри функционального апдейтера `setDraft`, который React Strict Mode
 * вызывает дважды для проверки чистоты. В результате каждое отпускание мыши
 * создавало две зоны с разными UUID, но идентичными координатами. Дубли
 * накладывались на canvas — визуально выглядели как одна, но в state их две.
 *
 * Этот модуль:
 *  1) Дедуплицирует зоны при загрузке из IndexedDB — нужен только потому, что
 *     у юзеров со старым билдом в кэше уже могут лежать дубли. Без него после
 *     обновления фронта они продолжали бы видеть удвоенные сигналы.
 *  2) Тестируется отдельно — простая чистая функция.
 */

import type { POIZone } from '@/types';

/**
 * Возвращает зоны без дублей с одинаковыми границами
 * (`startTime`, `endTime`, `minPrice`, `maxPrice`).
 *
 * Сохраняет порядок: оставляет первую встреченную зону каждого «отпечатка».
 */
export function dedupeZones(zones: readonly POIZone[]): POIZone[] {
  const seen = new Set<string>();
  const result: POIZone[] = [];
  for (const z of zones) {
    const key = `${z.startTime}:${z.endTime}:${z.minPrice}:${z.maxPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(z);
  }
  return result;
}
