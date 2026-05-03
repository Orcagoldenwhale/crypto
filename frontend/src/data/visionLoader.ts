/**
 * Загрузка реальных aggTrades с Binance Vision.
 *
 * Vision — публичный архив (https://data.binance.vision), без API-ключей и без лимитов.
 * Daily-zip с aggTrades содержит ВСЕ агрегированные сделки за UTC-сутки —
 * это правильный источник для построения настоящего footprint.
 *
 * Архитектура:
 *  1. fetch zip-архива через Vite-proxy (/vision/*)
 *  2. распаковка через fflate
 *  3. потоковая агрегация в `Candle5m[]` с настоящими кластерами Bid×Ask по уровням
 *
 * Кэш: каждый день кэшируется как набор Candle5m в IndexedDB по ключу
 * `vision:SYMBOL:YYYY-MM-DD`, чтобы повторные заходы были мгновенными.
 *
 * CSV-формат aggTrades (без header):
 *   aggTradeId, price, qty, firstId, lastId, timestamp_ms, isBuyerMaker, isBestMatch
 *
 * isBuyerMaker = true  → инициатор сделки SELL (taker SELL) → +qty в bid (агрессия в bid)
 * isBuyerMaker = false → инициатор сделки BUY  (taker BUY)  → +qty в ask
 */

import { unzipSync, strFromU8 } from 'fflate';
import type { Candle5m, Cluster, Dataset, DatasetMeta } from '@/types';
import { loadVisionDay, saveVisionDay } from './storage';

// ============================================================================
// Константы
// ============================================================================

const MS_5M = 5 * 60 * 1000;

/** Tick size для BTCUSDT spot. Для других пар нужно подгружать /api/v3/exchangeInfo. */
const DEFAULT_TICK_SIZE: Record<string, number> = {
  BTCUSDT: 0.1,
  ETHUSDT: 0.01,
};

// ============================================================================
// Публичный API
// ============================================================================

export interface FetchVisionArgs {
  symbol: string;
  /** Сколько UTC-дней назад грузить, не считая сегодняшнего (Vision публикует «вчера» с задержкой). */
  days: number;
  signal?: AbortSignal;
  onProgress?: (info: ProgressInfo) => void;
}

export interface ProgressInfo {
  /** 1..days */
  dayIndex: number;
  /** общее число дней */
  daysTotal: number;
  /** ISO дата для текущего дня (YYYY-MM-DD) */
  date: string;
  /** Текущий шаг */
  stage: 'cache' | 'download' | 'unzip' | 'parse' | 'done';
  /** Накоплено байт скачано (только для stage='download'). */
  bytes?: number;
  /** Кол-во распарсенных тиков (только для stage='parse'). */
  ticks?: number;
}

/**
 * Главная функция: возвращает Dataset с реальными кластерами за `days` дней BTCUSDT.
 * Бросает ошибку, если ВСЕ дни недоступны. Если часть дней получена — возвращает то, что есть.
 */
export async function fetchVisionDataset({
  symbol,
  days,
  signal,
  onProgress,
}: FetchVisionArgs): Promise<Dataset> {
  const dates = lastFinishedUtcDays(days);
  const candlesByDay: Candle5m[][] = [];
  const tickSize = DEFAULT_TICK_SIZE[symbol] ?? 0.1;
  const errors: string[] = [];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    if (!date) continue;
    const dayIndex = i + 1;

    onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'cache' });

    // 1) Кэш
    const cached = await loadVisionDay(symbol, date);
    if (cached && cached.length > 0) {
      candlesByDay.push(cached);
      onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'done' });
      continue;
    }

    try {
      // 2) Скачивание
      const buf = await fetchVisionZip(symbol, date, signal, (bytes) =>
        onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'download', bytes }),
      );

      // 3) Распаковка
      onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'unzip' });
      const csv = unzipFirstFile(buf);

      // 4) Парсинг + агрегация
      onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'parse', ticks: 0 });
      const candles = aggregateCsvToCandles(csv, tickSize, (ticks) =>
        onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'parse', ticks }),
      );

      // 5) Кэш
      await saveVisionDay(symbol, date, candles);

      candlesByDay.push(candles);
      onProgress?.({ dayIndex, daysTotal: dates.length, date, stage: 'done' });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') throw e;
      errors.push(`${date}: ${(e as Error).message ?? 'unknown'}`);
    }
  }

  const all = candlesByDay.flat().sort((a, b) => a.timestamp - b.timestamp);
  if (all.length === 0) {
    throw new Error(`Vision unavailable for all ${dates.length} days. ${errors.join('; ')}`);
  }

  const first = all[0]!;
  const last = all[all.length - 1]!;
  const meta: DatasetMeta = {
    symbol,
    exchange: 'binance',
    timeframe: '5m',
    tick_size: tickSize,
    from: new Date(first.timestamp).toISOString(),
    to: new Date(last.timestamp + MS_5M).toISOString(),
    candles_count: all.length,
    generated_at: new Date().toISOString(),
    source: 'binance-vision-aggTrades',
    version: 1,
  };

  return { meta, candles: all };
}

// ============================================================================
// Внутренние функции
// ============================================================================

/**
 * Возвращает последние `days` завершённых UTC-дат (исключая сегодняшнюю — она не загружена в Vision до конца суток).
 * Формат: 'YYYY-MM-DD'.
 */
function lastFinishedUtcDays(days: number): string[] {
  const result: string[] = [];
  const now = new Date();
  // Берём вчерашнюю UTC-дату как самую свежую.
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 1; i <= days; i++) {
    const d = new Date(todayUtcMs - i * 24 * 60 * 60 * 1000);
    result.push(d.toISOString().slice(0, 10));
  }
  return result.reverse();
}

async function fetchVisionZip(
  symbol: string,
  date: string,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void,
): Promise<Uint8Array> {
  const url = `/vision/data/spot/daily/aggTrades/${symbol}/${symbol}-aggTrades-${date}.zip`;

  const fetchOptions: RequestInit = {};
  if (signal) fetchOptions.signal = signal;
  const resp = await fetch(url, fetchOptions);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  // Стримим, чтобы был progress по байтам.
  const total = Number(resp.headers.get('content-length')) || 0;
  if (!resp.body) {
    const ab = await resp.arrayBuffer();
    onBytes(ab.byteLength);
    return new Uint8Array(ab);
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onBytes(received);
    }
  }
  void total;

  const out = new Uint8Array(received);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.byteLength;
  }
  return out;
}

function unzipFirstFile(zip: Uint8Array): string {
  const files = unzipSync(zip);
  const names = Object.keys(files);
  if (names.length === 0) throw new Error('Empty zip');
  const first = files[names[0]!];
  if (!first) throw new Error('Empty zip entry');
  return strFromU8(first);
}

// ============================================================================
// CSV → Candle5m[] с настоящими кластерами
// ============================================================================

interface ClusterAcc {
  bid: number;
  ask: number;
}

interface CandleAcc {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  /** key = round(price / tickSize), value = ClusterAcc */
  clusters: Map<number, ClusterAcc>;
}

/**
 * Потоковый парсинг CSV без хранения всех тиков в памяти.
 * Прогресс-callback дёргается каждые ~100 000 строк.
 */
function aggregateCsvToCandles(
  csv: string,
  tickSize: number,
  onProgress: (ticks: number) => void,
): Candle5m[] {
  const candles = new Map<number, CandleAcc>();
  let ticks = 0;

  // Строки разделены '\n'. Для скорости избегаем split('\n').
  const len = csv.length;
  let lineStart = 0;

  for (let i = 0; i <= len; i++) {
    const ch = i === len ? 10 : csv.charCodeAt(i);
    if (ch !== 10 /* \n */) continue;

    let lineEnd = i;
    if (lineEnd > lineStart && csv.charCodeAt(lineEnd - 1) === 13 /* \r */) lineEnd--;

    if (lineEnd > lineStart) {
      const line = csv.substring(lineStart, lineEnd);
      // Пропускаем header, если он вдруг появится (некоторые архивы Vision имеют заголовок).
      // tradeId всегда числовой, а в header — текст.
      const c0 = line.charCodeAt(0);
      if (c0 >= 48 && c0 <= 57) {
        parseLineInto(line, tickSize, candles);
        ticks++;
        if ((ticks & 0xffff) === 0) onProgress(ticks);
      }
    }
    lineStart = i + 1;
  }
  onProgress(ticks);

  // Финальная сборка Candle5m[] из аккумуляторов.
  const out: Candle5m[] = [];
  const sortedTimestamps = [...candles.keys()].sort((a, b) => a - b);
  for (const ts of sortedTimestamps) {
    const acc = candles.get(ts);
    if (!acc) continue;
    out.push(finalizeCandle(acc, tickSize));
  }
  return out;
}

function parseLineInto(
  line: string,
  tickSize: number,
  candles: Map<number, CandleAcc>,
): void {
  // Поля: aggTradeId, price, qty, firstId, lastId, timestamp_ms, isBuyerMaker, isBestMatch
  // Парсим вручную через indexOf(',') — заметно быстрее split.
  let p = 0;
  // skip aggTradeId
  let q = line.indexOf(',', p);
  if (q < 0) return;
  p = q + 1;

  q = line.indexOf(',', p);
  if (q < 0) return;
  const price = parseFloat(line.substring(p, q));
  p = q + 1;

  q = line.indexOf(',', p);
  if (q < 0) return;
  const qty = parseFloat(line.substring(p, q));
  p = q + 1;

  // skip firstId
  q = line.indexOf(',', p);
  if (q < 0) return;
  p = q + 1;
  // skip lastId
  q = line.indexOf(',', p);
  if (q < 0) return;
  p = q + 1;

  q = line.indexOf(',', p);
  if (q < 0) return;
  const ts = parseInt(line.substring(p, q), 10);
  p = q + 1;

  q = line.indexOf(',', p);
  // isBuyerMaker — может быть 'true'/'false' или 'True'/'False'. Хватит проверить первый символ.
  const isBuyerMakerRaw = q < 0 ? line.substring(p) : line.substring(p, q);
  const isBuyerMaker = isBuyerMakerRaw.charCodeAt(0) === 116 /* 't' */ || isBuyerMakerRaw.charCodeAt(0) === 84 /* 'T' */;

  if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) return;

  const candleTs = Math.floor(ts / MS_5M) * MS_5M;
  let candle = candles.get(candleTs);
  if (!candle) {
    candle = {
      timestamp: candleTs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
      delta: 0,
      clusters: new Map(),
    };
    candles.set(candleTs, candle);
  }

  if (price > candle.high) candle.high = price;
  if (price < candle.low) candle.low = price;
  candle.close = price;
  candle.volume += qty;
  candle.delta += isBuyerMaker ? -qty : qty;

  const bucketKey = Math.round(price / tickSize);
  let cl = candle.clusters.get(bucketKey);
  if (!cl) {
    cl = { bid: 0, ask: 0 };
    candle.clusters.set(bucketKey, cl);
  }
  if (isBuyerMaker) cl.bid += qty;
  else cl.ask += qty;
}

function finalizeCandle(acc: CandleAcc, tickSize: number): Candle5m {
  const sortedKeys = [...acc.clusters.keys()].sort((a, b) => a - b);
  const clusters: Cluster[] = [];
  let maxVol = 0;
  let vpocPrice = acc.low;
  let deltaAtLow = 0;
  let deltaAtHigh = 0;

  const lowKey = Math.round(acc.low / tickSize);
  const highKey = Math.round(acc.high / tickSize);

  for (const key of sortedKeys) {
    const cl = acc.clusters.get(key);
    if (!cl) continue;
    const price = key * tickSize;
    const vol = cl.bid + cl.ask;
    const delta = cl.ask - cl.bid;
    clusters.push({
      price,
      bid: cl.bid,
      ask: cl.ask,
      vol,
      delta,
    });
    if (vol > maxVol) {
      maxVol = vol;
      vpocPrice = price;
    }
    if (key === lowKey) deltaAtLow = delta;
    if (key === highKey) deltaAtHigh = delta;
  }

  return {
    timestamp: acc.timestamp,
    open: acc.open,
    high: acc.high,
    low: acc.low,
    close: acc.close,
    volume: acc.volume,
    delta: acc.delta,
    vpoc_price: vpocPrice,
    max_vol: maxVol,
    delta_at_low: deltaAtLow,
    delta_at_high: deltaAtHigh,
    clusters,
  };
}
