/**
 * Тримминг raw 5m свечей для расширенного бэктеста с учётом HTF-выравнивания.
 *
 * Проблема, которую решает: `array.slice(-candleCount)` берёт ровно N
 * последних свечей, но НЕ гарантирует что первая из них выровнена на
 * границу HTF (15m / 1h). Если первая 5m оказалась, скажем, в 06:40 UTC,
 * то `aggregate5mTo15mLtf` склеит [06:40, 06:45, 06:50] в «15m» с
 * timestamp=06:40 — сдвинуто относительно настоящих Binance 15m
 * (00/15/30/45). Разные timestamps → разные SMC-зоны → результаты
 * расширенного бэктеста не согласуются с регулярным.
 *
 * Решение: отбрасываем чуть-чуть больше свечей с фронта, чтобы первая
 * оставшаяся была кратна HTF-сетке.
 */

import type { Candle5m } from '@/types';
import type { ChartTimeframe } from '@/types';

/** Сколько 5m свечей входит в одну свечу заданного HTF. */
function candlesPer5mIn(htfTf: ChartTimeframe): number {
  switch (htfTf) {
    case '1h':
      return 12;
    case '15m':
      return 3;
    case '5m':
      return 1;
  }
}

/**
 * Возвращает срез raw 5m свечей длиной `~candleCount`, выровненный на
 * границу HTF. Реальное количество свечей в результате может быть меньше
 * запрошенного на (candlesPer5mIn(htfTf) - 1) — это плата за корректное
 * выравнивание.
 *
 * Контракт: первая свеча результата имеет timestamp кратный
 * MS_5M × candlesPer5mIn(htfTf). При условии что raw начинается с
 * UTC-полуночи (это инвариант Vision-загрузки), это эквивалентно
 * выравниванию на естественные границы Binance HTF.
 *
 * Если raw короче candleCount — возвращает весь raw (всё равно с
 * выравниванием с фронта).
 */
export function alignTrimForHtf(
  raw: readonly Candle5m[],
  candleCount: number,
  htfTf: ChartTimeframe,
): readonly Candle5m[] {
  if (raw.length === 0) return raw;

  const step = candlesPer5mIn(htfTf);

  // Сколько отбросить с фронта, чтобы остаться с candleCount.
  let dropCount = Math.max(0, raw.length - candleCount);

  // Округляем ВВЕРХ до ближайшего кратного step — даём гарантию что
  // первая оставшаяся свеча будет на HTF-границе (учитывая что raw[0]
  // на UTC-полуночи и значит на кратном-step индексе).
  if (step > 1) {
    dropCount = Math.ceil(dropCount / step) * step;
  }

  return raw.slice(dropCount);
}
