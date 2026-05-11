/**
 * Детектор Previous Day High/Low (PDH/PDL).
 *
 * Из лекции "Ликвидность", раздел 4:
 *   Previous day high/low — максимум/минимум предыдущего дня. Сильные
 *   зоны скопления ликвидности, интрадей-цели для цены.
 *   "После того, как цена пересекает данный уровень — он теряет актуальность."
 *
 * Алгоритм:
 *   1. Группируем все свечи по календарным дням (UTC).
 *   2. Для каждого ПОЛНОГО дня вычисляем максимум и минимум.
 *   3. Эти уровни активны с 00:00 UTC следующего дня.
 *   4. Mitigation: первая свеча, которая пересекла уровень телом или фитилём.
 *
 * Упрощение: рассматриваем только дни. Недели/месяцы пропускаем — данных мало.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { PrevDayLevelZone } from './types';

interface OhlcCandle {
  timestamp: number;
  high: number;
  low: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function detectPrevDayLevels(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
): PrevDayLevelZone[] {
  if (candles.length === 0) return [];
  const arr = candles as readonly OhlcCandle[];

  // 1. Группируем по дню (UTC). dayKey = floor(timestamp / day) * day.
  const days = new Map<number, { high: number; low: number; lastTs: number }>();
  for (const c of arr) {
    const dayStart = Math.floor(c.timestamp / MS_PER_DAY) * MS_PER_DAY;
    const cur = days.get(dayStart);
    if (cur === undefined) {
      days.set(dayStart, { high: c.high, low: c.low, lastTs: c.timestamp });
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.lastTs = c.timestamp;
    }
  }

  const sortedDayKeys = Array.from(days.keys()).sort((a, b) => a - b);
  if (sortedDayKeys.length < 2) return [];

  const lastTime = arr[arr.length - 1]!.timestamp;
  const out: PrevDayLevelZone[] = [];

  // 2. Для каждого дня (кроме последнего, т.к. он ещё формируется)
  //    выпускаем PDH/PDL, активные начиная со следующего дня.
  // Хотя бы один следующий день должен существовать в данных.
  for (let i = 0; i < sortedDayKeys.length - 1; i++) {
    const sourceDayKey = sortedDayKeys[i]!;
    const day = days.get(sourceDayKey)!;
    const startTime = sortedDayKeys[i + 1]!; // следующий день
    const sourceDate = isoDate(sourceDayKey);

    // PDH
    const pdhMitigation = findCrossing(arr, startTime, day.high, 'above');
    out.push({
      id: `pdh-${sourceDate}`,
      kind: 'high',
      price: day.high,
      startTime,
      endTime: pdhMitigation !== null ? pdhMitigation : lastTime,
      sourceDate,
      unmitigated: pdhMitigation === null,
    });

    // PDL
    const pdlMitigation = findCrossing(arr, startTime, day.low, 'below');
    out.push({
      id: `pdl-${sourceDate}`,
      kind: 'low',
      price: day.low,
      startTime,
      endTime: pdlMitigation !== null ? pdlMitigation : lastTime,
      sourceDate,
      unmitigated: pdlMitigation === null,
    });
  }

  return out;
}

/**
 * Возвращает timestamp первой свечи после `from`, которая пересекла уровень:
 *   direction='above': high >= price (фитиль пробил вверх)
 *   direction='below': low  <= price (фитиль пробил вниз)
 */
function findCrossing(
  arr: readonly OhlcCandle[],
  fromTime: number,
  price: number,
  direction: 'above' | 'below',
): number | null {
  for (const c of arr) {
    if (c.timestamp < fromTime) continue;
    if (direction === 'above' ? c.high >= price : c.low <= price) {
      return c.timestamp;
    }
  }
  return null;
}

function isoDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}
