/**
 * Регруппировка кластеров по укрупнённой ценовой сетке (tick × N).
 *
 * Зачем: на разных монетах исходный tick_size слишком мелкий — на
 * BTCUSDT с tick=5 свеча в 600$ амплитуды содержит 120 уровней;
 * визуально это «рябь», по которой невозможно читать ордерфлоу.
 * Объединение N соседних уровней в одну ячейку даёт читабельные
 * 10–30 уровней на свечу + переагрегирует bid/ask/vol/delta так,
 * чтобы инварианты (vol = bid+ask, delta = ask-bid) сохранились.
 *
 * Ключевые свойства:
 *   - чистая функция, без побочных эффектов;
 *   - целочисленные индексы в исходной сетке → нет накопления
 *     ошибок floating point (важно для tick_size = 0.05 / 0.5 / 5);
 *   - VPOC и max_vol пересчитываются на УКРУПНЁННОЙ сетке —
 *     иначе фронт показывал бы старый VPOC, не существующий
 *     в новой геометрии;
 *   - delta_at_low / delta_at_high пересчитываются по бакету,
 *     в который попадает candle.low / candle.high — это нужно
 *     сканеру (правило absorption смотрит на эти поля).
 */

import type { Candle5m, Cluster } from '@/types';

/**
 * Допустимые множители tick_size.
 *
 * 1 — исходная сетка (no-op), остальные — целые делители для предсказуемого
 * поведения. Если хотим больше — добавим, но 1/2/5/10 покрывают все
 * реалистичные сценарии чтения ордерфлоу.
 */
export type TickMultiplier = 1 | 2 | 5 | 10;

export const TICK_MULTIPLIER_VALUES: readonly TickMultiplier[] = [1, 2, 5, 10] as const;

/**
 * Возвращает базовый tick_size, выводя его из расстояния между соседними
 * кластерами. В сжатой форме (без пустых ячеек) шаг между соседними не
 * обязательно равен tick — там могут быть «дыры». Поэтому берём минимум
 * положительной разности — это и есть tick_size исходной сетки.
 *
 * Возвращает 0, если определить невозможно (< 2 кластеров) — значит,
 * регруппировка не имеет смысла, вернём свечу как есть.
 */
export function detectBaseTickSize(clusters: readonly Cluster[]): number {
  if (clusters.length < 2) return 0;
  let minDiff = Infinity;
  for (let i = 1; i < clusters.length; i++) {
    const a = clusters[i - 1]!.price;
    const b = clusters[i]!.price;
    const d = b - a;
    if (d > 0 && d < minDiff) minDiff = d;
  }
  return Number.isFinite(minDiff) ? minDiff : 0;
}

/**
 * Регруппирует кластеры одной свечи под укрупнённую сетку tick × multiplier.
 *
 * Если multiplier = 1 — возвращает исходную свечу без копирования (быстрый no-op).
 * Если у свечи < 2 кластеров (Binance klines fallback) — тоже no-op: нечего
 * группировать, и формально tick_size не определён.
 */
export function regroupCandle(
  candle: Candle5m,
  multiplier: TickMultiplier,
): Candle5m {
  if (multiplier === 1) return candle;
  if (candle.clusters.length < 2) return candle;

  const baseTick = detectBaseTickSize(candle.clusters);
  if (baseTick <= 0) return candle;

  // Группируем кластеры в новые бакеты.
  // Ключ — целочисленный индекс группы в новой сетке. Это исключает
  // накопление floating-point ошибок для дробных tick_size (0.05 для SOL).
  const buckets = new Map<
    number,
    { bid: number; ask: number; vol: number; delta: number }
  >();

  for (const cl of candle.clusters) {
    const baseIdx = Math.round(cl.price / baseTick);
    const groupIdx = Math.floor(baseIdx / multiplier);
    const existing = buckets.get(groupIdx);
    if (existing) {
      existing.bid += cl.bid;
      existing.ask += cl.ask;
      existing.vol += cl.vol;
      existing.delta += cl.delta;
    } else {
      buckets.set(groupIdx, {
        bid: cl.bid,
        ask: cl.ask,
        vol: cl.vol,
        delta: cl.delta,
      });
    }
  }

  // Сборка отсортированного списка кластеров. Ключи — целые → сортировка точная.
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);
  const newClusters: Cluster[] = sortedKeys.map((groupIdx) => {
    const agg = buckets.get(groupIdx)!;
    // Выравниваем цену через целочисленный индекс — без drift'а.
    const price = groupIdx * multiplier * baseTick;
    return {
      price,
      bid: agg.bid,
      ask: agg.ask,
      vol: agg.vol,
      delta: agg.delta,
    };
  });

  // Пересчёт VPOC и max_vol — они описывают НОВУЮ сетку.
  // Stable: при равных vol берём первый встреченный (самый низкий по цене).
  let vpocPrice = newClusters[0]!.price;
  let maxVol = newClusters[0]!.vol;
  for (let i = 1; i < newClusters.length; i++) {
    const c = newClusters[i]!;
    if (c.vol > maxVol) {
      maxVol = c.vol;
      vpocPrice = c.price;
    }
  }

  // delta_at_low / delta_at_high — дельта группы, в которую попадают
  // экстремумы свечи. Правило absorption сканера читает эти поля,
  // поэтому без пересчёта мы бы дали ему «старую» цифру.
  const lowGroupIdx = Math.floor(Math.round(candle.low / baseTick) / multiplier);
  const highGroupIdx = Math.floor(Math.round(candle.high / baseTick) / multiplier);
  const lowBucket = buckets.get(lowGroupIdx);
  const highBucket = buckets.get(highGroupIdx);

  return {
    ...candle,
    clusters: newClusters,
    vpoc_price: vpocPrice,
    max_vol: maxVol,
    delta_at_low: lowBucket?.delta ?? 0,
    delta_at_high: highBucket?.delta ?? 0,
  };
}

/**
 * Регруппирует все свечи датасета. Аллоцирует новый массив только если
 * multiplier != 1 — при ×1 возвращает исходный массив (referential equality
 * сохраняется → React не пере-рендеривает чарт без нужды).
 */
export function regroupCandles(
  candles: readonly Candle5m[],
  multiplier: TickMultiplier,
): Candle5m[] {
  if (multiplier === 1) return candles as Candle5m[];
  const result: Candle5m[] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    result[i] = regroupCandle(candles[i]!, multiplier);
  }
  return result;
}

/**
 * Авто-выбор multiplier'а по плотности кластеров в датасете.
 *
 * Цель — попасть в зону «10–25 ячеек на видимую свечу» при средней
 * амплитуде. Плотность считаем как среднее число кластеров на свечу
 * (только по свечам с >= 2 кластерами — пустые/Binance-fallback не считаем).
 *
 * Пороги подобраны эмпирически:
 *   ≤ 25  кластеров/свеча → ×1
 *   ≤ 60  → ×2
 *   ≤ 150 → ×5
 *   иначе → ×10
 */
export function computeAutoMultiplier(
  candles: readonly Candle5m[],
): TickMultiplier {
  if (candles.length === 0) return 1;
  let total = 0;
  let n = 0;
  for (const c of candles) {
    if (c.clusters.length >= 2) {
      total += c.clusters.length;
      n++;
    }
  }
  if (n === 0) return 1;
  const avg = total / n;
  if (avg <= 25) return 1;
  if (avg <= 60) return 2;
  if (avg <= 150) return 5;
  return 10;
}
