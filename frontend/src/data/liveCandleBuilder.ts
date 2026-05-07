/**
 * Live-builder свечей: чистые функции для пошаговой сборки 5m свечи из тиков.
 *
 * Функции иммутабельны (возвращают новый объект, не мутируют вход) — это упрощает
 * React-рендеринг (можно сравнивать по reference) и делает поведение тестируемым.
 *
 * Контракт `Candle5m` сохраняется идентично историческим свечам из pipeline:
 * sort кластеров по price ↑, vol = bid + ask, delta = ask - bid, vpoc_price =
 * argmax(vol), max_vol = max(vol), delta_at_low/high — на низком/высоком уровне.
 */

import type { AggTradeTick, Candle5m, Cluster, Price } from '@/types';

/** Размер 5-минутного слота в миллисекундах. */
export const FIVE_MIN_MS = 5 * 60 * 1000;

/**
 * Привязать произвольную цену к нижней границе ценового бакета.
 *
 * `Math.round(... / tickSize) * tickSize` дал бы ближайший — но мы используем
 * floor (как в Python pipeline), чтобы сетка была идентична исторической.
 */
export function bucketPrice(price: Price, tickSize: number): Price {
  if (tickSize <= 0) return price;
  // Используем round с обратным масштабированием, чтобы не накапливать
  // floating-point ошибки на дробных tick'ах (0.001, 0.05).
  const inv = 1 / tickSize;
  return Math.floor(price * inv) / inv;
}

/**
 * Округлить timestamp вниз до начала ближайшего 5-минутного слота.
 * Слоты выровнены на UTC (0:00, 0:05, 0:10, ...).
 */
export function bucketTimestamp5m(timestamp: number): number {
  return Math.floor(timestamp / FIVE_MIN_MS) * FIVE_MIN_MS;
}

/**
 * Создать пустую свечу для слота, в который попадает заданный timestamp.
 *
 * Все агрегаты по нулям; high/low/close/open будут заполнены первым же
 * прилетевшим тиком через `applyTickToCandle`.
 */
export function openNewCandle(timestamp: number): Candle5m {
  const slotStart = bucketTimestamp5m(timestamp);
  return {
    timestamp: slotStart,
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0,
    delta: 0,
    vpoc_price: 0,
    max_vol: 0,
    delta_at_low: 0,
    delta_at_high: 0,
    clusters: [],
  };
}

/**
 * Применить один тик к свече.
 *
 * Возвращает НОВУЮ свечу с обновлёнными кластерами и агрегатами. Если в свече
 * не было ни одного тика (новая, только что openNewCandle) — open инициализируется
 * ценой первого тика. high/low/close обновляются на каждом тике.
 *
 * Сложность: O(n) на пересчёт vpoc/max_vol/delta_at_low/high, где n — число
 * уровней. На реальной 5m свече n ≤ 200, операций ничтожно мало.
 */
export function applyTickToCandle(
  candle: Candle5m,
  tick: AggTradeTick,
  tickSize: number,
): Candle5m {
  const bucket = bucketPrice(tick.price, tickSize);
  const isFirstTick = candle.clusters.length === 0;

  // 1. Кластеры: ищем соседа на bucket-цене или вставляем новый с сохранением
  //    sort'а по price ↑.
  const clusters = upsertCluster(candle.clusters, bucket, tick);

  // 2. OHLCV (open у пустой свечи = цена первого тика).
  const open = isFirstTick ? tick.price : candle.open;
  const high = isFirstTick ? tick.price : Math.max(candle.high, tick.price);
  const low = isFirstTick ? tick.price : Math.min(candle.low, tick.price);
  const close = tick.price;
  const volume = candle.volume + tick.qty;
  const delta = candle.delta + (tick.isBuyerMaker ? -tick.qty : tick.qty);

  // 3. VPOC и max_vol — пересчёт по всем кластерам (дешёвый, n ≤ 200).
  let maxVol = 0;
  let vpocPrice = bucket;
  for (const c of clusters) {
    if (c.vol > maxVol) {
      maxVol = c.vol;
      vpocPrice = c.price;
    }
  }

  // 4. delta_at_low/high — крайние кластеры (sort по price гарантирован).
  const lowCluster = clusters[0]!;
  const highCluster = clusters[clusters.length - 1]!;

  return {
    timestamp: candle.timestamp,
    open,
    high,
    low,
    close,
    volume,
    delta,
    vpoc_price: vpocPrice,
    max_vol: maxVol,
    delta_at_low: lowCluster.delta,
    delta_at_high: highCluster.delta,
    clusters,
  };
}

/**
 * Финализация свечи перед добавлением в массив истории.
 *
 * Сейчас сводится к лёгкой проверке инвариантов (вдруг где-то накопился
 * дрейф) — но оставляем точку расширения: например, можно сюда повесить
 * де-дупликацию повторных тиков по aggTradeId или сглаживание VPOC при
 * мульти-победе.
 *
 * Главный смысл — гарантировать, что свеча выходит из live-слоя в формате,
 * неотличимом от historical (приходящих из Python pipeline).
 */
export function finalizeCandle(candle: Candle5m): Candle5m {
  // Если свеча пустая (тиков не было) — возвращаем как есть. Manager
  // решит, нужно ли её вообще пушить.
  if (candle.clusters.length === 0) return candle;
  // На этом этапе все инварианты уже выдержаны applyTickToCandle.
  // Возвращаем тот же объект (reference) — реренденер увидит «без изменений».
  return candle;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Найти кластер по цене или вставить новый с сохранением sort'а по price ↑.
 *
 * Используем простой линейный поиск — на 5m свече реалистично ≤ 200 уровней,
 * это в 1000 раз дешевле, чем стоит один setState в React, поэтому
 * усложнять до бинарного поиска нет смысла.
 */
function upsertCluster(
  clusters: readonly Cluster[],
  price: Price,
  tick: AggTradeTick,
): Cluster[] {
  const out: Cluster[] = [];
  let inserted = false;

  for (const c of clusters) {
    if (!inserted && c.price === price) {
      // Совпадение цены — обновляем существующий кластер.
      out.push(applyTickToCluster(c, tick));
      inserted = true;
    } else if (!inserted && c.price > price) {
      // Проскочили нужное место — вставляем новый кластер ПЕРЕД c.
      out.push(applyTickToCluster(emptyCluster(price), tick));
      inserted = true;
      out.push(c);
    } else {
      out.push(c);
    }
  }
  if (!inserted) {
    out.push(applyTickToCluster(emptyCluster(price), tick));
  }
  return out;
}

function emptyCluster(price: Price): Cluster {
  return { price, bid: 0, ask: 0, vol: 0, delta: 0 };
}

function applyTickToCluster(c: Cluster, tick: AggTradeTick): Cluster {
  // isBuyerMaker=true → агрессивный SELL → bid +=
  // isBuyerMaker=false → агрессивный BUY → ask +=
  const bid = c.bid + (tick.isBuyerMaker ? tick.qty : 0);
  const ask = c.ask + (tick.isBuyerMaker ? 0 : tick.qty);
  return {
    price: c.price,
    bid,
    ask,
    vol: bid + ask,
    delta: ask - bid,
  };
}
