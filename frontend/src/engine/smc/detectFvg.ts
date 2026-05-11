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
   * Прятать ли уже закрытые FVG (отработанные заполнением цены).
   * Если false — отдаём все, в зоне `unmitigated: false`.
   */
  hideMitigated?: boolean;
  /**
   * FVG считается mitigated, когда перекрыт более чем на X% (0–100).
   * По умолчанию 0 — любое касание закрывает зону (старое поведение).
   */
  maxFillPct?: number;
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

  const maxFillPct = options.maxFillPct ?? 0;
  const out: FvgZone[] = [];
  const lastTime = candles[n - 1]!.timestamp;

  for (let i = 1; i < n - 1; i++) {
    const prev = candles[i - 1] as OhlcCandle;
    const cur = candles[i] as OhlcCandle;
    const next = candles[i + 1] as OhlcCandle;
    if (!prev || !cur || !next) continue;

    // Bull FVG: low[i+1] строго выше high[i-1]
    // startTime = next.timestamp: зона существует только ПОСЛЕ закрытия 3-й свечи.
    if (next.low > prev.high) {
      const zone = buildAndMitigate({
        kind: 'bull',
        startIdx: i - 1,
        startTime: next.timestamp,
        minPrice: prev.high,
        maxPrice: next.low,
        candles,
        lastTime,
        maxFillPct,
      });
      pushIfAllowed(out, zone, options);
      continue;
    }

    if (next.high < prev.low) {
      const zone = buildAndMitigate({
        kind: 'bear',
        startIdx: i - 1,
        startTime: next.timestamp,
        minPrice: next.high,
        maxPrice: prev.low,
        candles,
        lastTime,
        maxFillPct,
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
  maxFillPct: number;
}

function buildAndMitigate(a: BuildArgs): FvgZone {
  const { kind, startIdx, startTime, minPrice, maxPrice, candles, lastTime, maxFillPct } = a;
  const mitStart = startIdx + 3;
  const height = maxPrice - minPrice;
  let endTime = lastTime;
  let unmitigated = true;
  let peakFill = 0;

  for (let k = mitStart; k < candles.length; k++) {
    const c = candles[k]!;
    const penetration = kind === 'bull'
      ? maxPrice - c.low
      : c.high - minPrice;
    const fillPct = height > 0 ? Math.max(0, (penetration / height) * 100) : 0;
    if (fillPct > peakFill) peakFill = fillPct;
    if (peakFill > maxFillPct) {
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
