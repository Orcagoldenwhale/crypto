/**
 * Детерминированный генератор тестовых 5m свечей с кластерной разбивкой.
 *
 * Назначение: дать UI и сканеру реалистичные данные ТОГО ЖЕ ФОРМАТА,
 * что выдаёт Python-pipeline (см. docs/03-data-format.md), чтобы построить
 * фронт не дожидаясь готовности pipeline.
 *
 * Ключевые свойства:
 *   - Полностью детерминирован: одинаковый seed → побайтово одинаковый результат.
 *     Это критично для unit-тестов сканера и для сверки картинки.
 *   - Соблюдает все инварианты из docs/03-data-format.md:
 *       volume = sum(clusters[].vol)
 *       delta  = sum(clusters[].delta)
 *       vpoc_price ∈ clusters[].price
 *       max_vol = max(clusters[].vol)
 *       delta_at_low соответствует кластеру с price === low
 *       delta_at_high соответствует кластеру с price === high
 *       clusters[].vol = bid + ask
 *       clusters[].delta = ask - bid
 *   - Внедряет «идеальные» свечи LONG и SHORT в заданных индексах,
 *     чтобы сканер мог их найти на этапе тестирования.
 */

import type { Candle5m, Cluster, Dataset, DatasetMeta } from '@/types';

// ============================================================================
// Константы
// ============================================================================

const MS_PER_5M = 5 * 60 * 1000;
const DEFAULT_TICK_SIZE = 5;

/** 1 440 свечей = 5 календарных дней по 5 минут */
export const DEFAULT_CANDLES_COUNT = 1440;

/** Стартовая дата для воспроизводимости — 2026-04-26 00:00 UTC */
const DEFAULT_START_TIMESTAMP = Date.UTC(2026, 3, 26, 0, 0, 0);

const DEFAULT_START_PRICE = 64_000;
const DEFAULT_SEED = 42;

// ============================================================================
// Детерминированный PRNG (mulberry32)
// ============================================================================

/**
 * Создаёт детерминированный RNG в диапазоне [0, 1).
 * mulberry32 — компактный высококачественный PRNG.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ============================================================================
// Параметры генерации
// ============================================================================

export interface GenerateOptions {
  /** Количество 5-минутных свечей (по умолчанию 1440 = 5 дней) */
  numCandles?: number;
  /** Стартовый Unix-timestamp в мс (выровненный на 5m сетку) */
  startTimestamp?: number;
  /** Стартовая цена */
  startPrice?: Price;
  /** Шаг ценовой сетки */
  tickSize?: number;
  /** Seed для детерминированности */
  seed?: number;
  /** Индекс свечи, в которую внедрить «идеальный» сигнал LONG */
  perfectLongIndex?: number;
  /** Индекс свечи, в которую внедрить «идеальный» сигнал SHORT */
  perfectShortIndex?: number;
  /** Тикер для meta */
  symbol?: string;
}

type Price = number;

// ============================================================================
// Генерация одной свечи
// ============================================================================

interface CandleGenContext {
  rng: () => number;
  tickSize: number;
  prevClose: Price;
  index: number;
  isPerfectLong: boolean;
  isPerfectShort: boolean;
}

function alignDown(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function alignUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

function generateClusters(
  low: Price,
  high: Price,
  ctx: CandleGenContext,
): { clusters: Cluster[]; vpocPrice: Price; maxVol: number; totalVol: number; totalDelta: number } {
  const { rng, tickSize, isPerfectLong, isPerfectShort } = ctx;
  const range = high - low;
  // Цены-якоря для «идеальных» сетапов, выровненные на tick.
  const longVpocAnchor = alignDown(low + range * 0.3, tickSize);
  const shortVpocAnchor = alignDown(low + range * 0.7, tickSize);

  const numLevels = Math.round(range / tickSize) + 1;
  const clusters: Cluster[] = [];
  let totalVol = 0;
  let totalDelta = 0;
  let maxVol = 0;
  let vpocPrice = low;

  for (let i = 0; i < numLevels; i++) {
    const price = low + i * tickSize;
    let bid: Volume;
    let ask: Volume;

    if (isPerfectLong) {
      if (price === low) {
        // Поглощение на лоу: огромный bid (агрессивные продажи), но цена не упала.
        // Дельта на лоу должна быть < 0 → правило #4 для LONG.
        bid = 350;
        ask = 50;
      } else if (price === longVpocAnchor) {
        // VPOC на ~30% от диапазона → close (75%) > vpoc → правило #3 для LONG.
        // Тут же максимум ask, чтобы дельта свечи была положительная → правило #2.
        bid = 300;
        ask = 900;
      } else {
        // Прочие уровни: ask доминирует чтобы общая дельта осталась положительной.
        const baseBid = Math.floor(rng() * 50) + 10;
        bid = baseBid;
        ask = baseBid + Math.floor(rng() * 100) + 30;
      }
    } else if (isPerfectShort) {
      if (price === high) {
        // Поглощение на хае → правило #4 для SHORT (delta_at_high > 0).
        bid = 50;
        ask = 350;
      } else if (price === shortVpocAnchor) {
        // VPOC на ~70% диапазона → close (25%) < vpoc → правило #3 для SHORT.
        bid = 900;
        ask = 300;
      } else {
        // Bid доминирует → общая дельта < 0 → правило #2 для SHORT.
        const baseAsk = Math.floor(rng() * 50) + 10;
        ask = baseAsk;
        bid = baseAsk + Math.floor(rng() * 100) + 30;
      }
    } else {
      // Обычная свеча: симметричный случайный объём с биасом к середине диапазона.
      bid = Math.floor(rng() * 100) + 20;
      ask = Math.floor(rng() * 100) + 20;
      const relPos = range > 0 ? (price - low) / range : 0.5;
      if (relPos > 0.3 && relPos < 0.7) {
        bid += 150;
        ask += 150;
      }
    }

    const vol = bid + ask;
    const delta = ask - bid;

    clusters.push({ price, bid, ask, vol, delta });
    totalVol += vol;
    totalDelta += delta;

    if (vol > maxVol) {
      maxVol = vol;
      vpocPrice = price;
    }
  }

  return { clusters, vpocPrice, maxVol, totalVol, totalDelta };
}

type Volume = number;

function generateCandle(timestamp: number, ctx: CandleGenContext): Candle5m {
  const { rng, tickSize, prevClose, index, isPerfectLong, isPerfectShort } = ctx;

  const trend = Math.sin(index / 30);
  const volatility = 30 + rng() * 40;

  const open = prevClose;
  let close = open + (rng() * volatility * 2 - volatility) + trend * 15;
  let high = Math.max(open, close) + rng() * 20;
  let low = Math.min(open, close) - rng() * 20;

  high = alignUp(high, tickSize);
  low = alignDown(low, tickSize);

  // Гарантируем минимум один уровень даже при крошечном диапазоне.
  if (high === low) {
    high = low + tickSize;
  }

  // Внедряем «идеальную» полярность закрытия для тестовых сетапов.
  if (isPerfectLong) {
    close = low + (high - low) * 0.75; // close в верхней половине → правило #1
  } else if (isPerfectShort) {
    close = low + (high - low) * 0.25; // close в нижней половине → правило #1
  }

  // Защита: open/close не выходят за low/high (после внедрения "идеальных").
  if (close > high) close = high;
  if (close < low) low = close;

  const { clusters, vpocPrice, maxVol, totalVol, totalDelta } = generateClusters(low, high, ctx);

  // delta_at_low / delta_at_high — кластеры строго на крайних уровнях.
  // Из-за алгоритма выше они гарантированно существуют.
  const lowCluster = clusters[0];
  const highCluster = clusters[clusters.length - 1];

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: totalVol,
    delta: totalDelta,
    vpoc_price: vpocPrice,
    max_vol: maxVol,
    delta_at_low: lowCluster?.delta ?? 0,
    delta_at_high: highCluster?.delta ?? 0,
    clusters,
  };
}

// ============================================================================
// Главная функция
// ============================================================================

export function generateMockData(options: GenerateOptions = {}): Dataset {
  const numCandles = options.numCandles ?? DEFAULT_CANDLES_COUNT;
  const startTimestamp = options.startTimestamp ?? DEFAULT_START_TIMESTAMP;
  const startPrice = options.startPrice ?? DEFAULT_START_PRICE;
  const tickSize = options.tickSize ?? DEFAULT_TICK_SIZE;
  const seed = options.seed ?? DEFAULT_SEED;
  const symbol = options.symbol ?? 'BTCUSDT';

  // По умолчанию помещаем «идеальные» сетапы на 40% и 65% датасета.
  // Это гарантирует, что они окажутся внутри 5-дневного периода и
  // пользователь сможет их найти, нарисовав POI вокруг этих timestamp'ов.
  const perfectLongIndex = options.perfectLongIndex ?? Math.floor(numCandles * 0.4);
  const perfectShortIndex = options.perfectShortIndex ?? Math.floor(numCandles * 0.65);

  const rng = createRng(seed);
  const candles: Candle5m[] = [];
  let prevClose = startPrice;
  let timestamp = startTimestamp;

  for (let i = 0; i < numCandles; i++) {
    const candle = generateCandle(timestamp, {
      rng,
      tickSize,
      prevClose,
      index: i,
      isPerfectLong: i === perfectLongIndex,
      isPerfectShort: i === perfectShortIndex,
    });
    candles.push(candle);
    prevClose = candle.close;
    timestamp += MS_PER_5M;
  }

  const fromIso = new Date(startTimestamp).toISOString();
  const toIso = new Date(startTimestamp + numCandles * MS_PER_5M).toISOString();

  const meta: DatasetMeta = {
    symbol,
    exchange: 'mock',
    timeframe: '5m',
    tick_size: tickSize,
    from: fromIso,
    to: toIso,
    candles_count: numCandles,
    generated_at: new Date().toISOString(),
    source: 'mockGenerator',
    version: 1,
  };

  return { meta, candles };
}
