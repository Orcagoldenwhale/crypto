/**
 * Детектор Fair Value Gaps (FVG) — трёхсвечная классическая модель.
 *
 *   Bull FVG (gap up, бычий разрыв):
 *     low[i+1] > high[i-1]   ← пустота между свечами i-1 и i+1
 *     зона = [high[i-1] .. low[i+1]]
 *
 *   Bear FVG (gap down, медвежий):
 *     high[i+1] < low[i-1]
 *     зона = [high[i+1] .. low[i-1]]
 *
 * Свеча i ("displacement candle") должна быть достаточно крупной — её тело
 * покрывает разрыв. Никаких дополнительных фильтров на этапе 1 не делаем,
 * чтобы видеть честное распределение разрывов.
 *
 * Mitigation: FVG считается отработанным, как только цена ВЕРНУЛАСЬ внутрь
 * зоны (касание). Для bull — low[k] <= maxPrice; для bear — high[k] >= minPrice.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { FvgZone } from './types';

interface OhlcCandle {
  timestamp: number;
  high: number;
  low: number;
}

export interface DetectFvgOptions {
  /**
   * Прятать ли уже закрытые FVG (отработанные касанием цены).
   * Если false — отдаём все, в зоне `unmitigated: false`.
   */
  hideMitigated?: boolean;
}

/**
 * Возвращает список FVG в данных, отсортированный по startTime.
 *
 * Алгоритм:
 *   1. Идём окном из 3 свечей (i-1, i, i+1) от индекса 1 до n-2.
 *   2. Для каждой найденной зоны проверяем касание дальнейшими свечами:
 *      первое касание → закрываем зону на этой свече; иначе зона живёт до конца.
 *
 * Сложность: O(n²) в худшем случае — но `mitigation` обычно ловится в первых
 * десятках свечей справа, так что на практике почти линейно.
 */
export function findFVGs(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  options: DetectFvgOptions = {},
): FvgZone[] {
  const n = candles.length;
  if (n < 3) return [];

  const out: FvgZone[] = [];
  // Касается общая граница времени для НЕ-mitigated зон — они расширяются
  // до последней свечи, чтобы при панораме график показывал актуальный край.
  const lastTime = candles[n - 1]!.timestamp;

  for (let i = 1; i < n - 1; i++) {
    const prev = candles[i - 1] as OhlcCandle;
    const cur = candles[i] as OhlcCandle;
    const next = candles[i + 1] as OhlcCandle;
    if (!prev || !cur || !next) continue;

    // Bull FVG: low[i+1] строго выше high[i-1]
    if (next.low > prev.high) {
      const zone = buildAndMitigate({
        kind: 'bull',
        startIdx: i - 1,
        startTime: prev.timestamp,
        minPrice: prev.high,
        maxPrice: next.low,
        candles,
        lastTime,
      });
      pushIfAllowed(out, zone, options);
      continue;
    }

    // Bear FVG: high[i+1] строго ниже low[i-1]
    if (next.high < prev.low) {
      const zone = buildAndMitigate({
        kind: 'bear',
        startIdx: i - 1,
        startTime: prev.timestamp,
        minPrice: next.high,
        maxPrice: prev.low,
        candles,
        lastTime,
      });
      pushIfAllowed(out, zone, options);
    }
  }

  return out;
}

interface BuildArgs {
  kind: 'bull' | 'bear';
  startIdx: number;
  startTime: number;
  minPrice: number;
  maxPrice: number;
  candles: readonly OhlcCandle[];
  lastTime: number;
}

function buildAndMitigate(a: BuildArgs): FvgZone {
  const { kind, startIdx, startTime, minPrice, maxPrice, candles, lastTime } = a;
  // Mitigation ищем НАЧИНАЯ со свечи i+2 (после displacement-тройки).
  // Это устоявшаяся практика: если цена не вышла из тройки сразу, разрыв
  // считается реальным и его потом тестируют.
  const mitStart = startIdx + 3;
  let endTime = lastTime;
  let unmitigated = true;
  for (let k = mitStart; k < candles.length; k++) {
    const c = candles[k]!;
    const touched =
      kind === 'bull' ? c.low <= maxPrice : c.high >= minPrice;
    if (touched) {
      endTime = c.timestamp;
      unmitigated = false;
      break;
    }
  }

  return {
    id: `fvg-${kind}-${startTime}`,
    kind,
    startTime,
    endTime,
    minPrice,
    maxPrice,
    unmitigated,
  };
}

function pushIfAllowed(
  out: FvgZone[],
  zone: FvgZone,
  options: DetectFvgOptions,
): void {
  if (options.hideMitigated && !zone.unmitigated) return;
  out.push(zone);
}
