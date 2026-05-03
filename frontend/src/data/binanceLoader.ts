/**
 * Загрузка исторических свечей с Binance Spot REST API.
 *
 * Эндпоинт: GET https://api.binance.com/api/v3/klines
 * - Бесплатный, без API-ключа, поддерживает CORS (можно дёргать прямо из браузера)
 * - Лимит: 1000 свечей за один запрос → для 5 дней (1440 × 5m) делаем 2 запроса
 *
 * ВАЖНО: klines НЕ содержат кластерной разбивки по уровням цены —
 * только OHLCV + taker buy volume (агрессивные покупки).
 * Поэтому общая дельта свечи (delta = ask - bid) восстанавливается ТОЧНО,
 * а вот VPOC и кластеры на уровнях — нет. Для полноценного footprint
 * нужны aggTrades (Этап 7, Python pipeline через Binance Vision).
 *
 * До Этапа 7 кластера представлены одной "свёрнутой" записью на свечу:
 * price = (high+low)/2, bid/ask из taker_buy_volume.
 */

import { z } from 'zod';
import type { Candle5m, Cluster, Dataset, DatasetMeta } from '@/types';

// ============================================================================
// Константы
// ============================================================================

const BINANCE_REST = 'https://api.binance.com/api/v3/klines';
const MS_5M = 5 * 60 * 1000;
const BATCH_LIMIT = 1000;
const MAX_RETRIES = 3;

// ============================================================================
// Схема ответа Binance — валидируем через Zod
// ============================================================================

/**
 * Один kline — массив фиксированной длины 12.
 * См. https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
 */
const KlineRawSchema = z.tuple([
  z.number(), // [0]  open time (ms)
  z.string(), // [1]  open
  z.string(), // [2]  high
  z.string(), // [3]  low
  z.string(), // [4]  close
  z.string(), // [5]  volume (base asset, например BTC)
  z.number(), // [6]  close time
  z.string(), // [7]  quote asset volume
  z.number(), // [8]  number of trades
  z.string(), // [9]  taker buy base asset volume
  z.string(), // [10] taker buy quote asset volume
  z.string(), // [11] ignore (legacy)
]);

const KlinesArraySchema = z.array(KlineRawSchema);

// ============================================================================
// Параметры
// ============================================================================

export interface FetchOptions {
  symbol?: string;
  /** Сколько прошлых дней загружать */
  days?: number;
  /** Шаг ценовой сетки для синтетических кластеров */
  tickSize?: number;
  /** AbortController для отмены текущей загрузки */
  signal?: AbortSignal;
  /** Колбэк прогресса (загружено N свечей из M) */
  onProgress?: (loaded: number, total: number) => void;
}

// ============================================================================
// Низкоуровневый запрос batch'а с retry
// ============================================================================

interface BatchRequest {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  limit: number;
  signal?: AbortSignal;
}

async function fetchBatch(req: BatchRequest): Promise<z.infer<typeof KlinesArraySchema>> {
  const url = new URL(BINANCE_REST);
  url.searchParams.set('symbol', req.symbol);
  url.searchParams.set('interval', req.interval);
  url.searchParams.set('startTime', String(req.startTime));
  url.searchParams.set('endTime', String(req.endTime));
  url.searchParams.set('limit', String(req.limit));

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let json: unknown;
    try {
      const fetchOpts: RequestInit = req.signal ? { signal: req.signal } : {};
      const res = await fetch(url.toString(), fetchOpts);

      // Rate-limit: backoff и повтор
      if (res.status === 429 || res.status === 418) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? 1);
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Binance API ${res.status}: ${res.statusText}`);
      }

      json = await res.json();
    } catch (e) {
      lastError = e;
      if ((e as { name?: string }).name === 'AbortError') throw e;
      if (attempt < MAX_RETRIES - 1) {
        // Экспоненциальный backoff: 500 → 1000 → 2000 ms
        await sleep(500 * Math.pow(2, attempt));
      }
      continue;
    }

    // Парсинг — без retry: невалидная схема не починится повтором.
    return KlinesArraySchema.parse(json);
  }
  throw lastError ?? new Error('Binance fetch failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Преобразование klines → Candle5m
// ============================================================================

function alignDown(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function klineToCandle5m(
  raw: z.infer<typeof KlineRawSchema>,
  tickSize: number,
): Candle5m {
  const timestamp = raw[0];
  const open = parseFloat(raw[1]);
  const high = parseFloat(raw[2]);
  const low = parseFloat(raw[3]);
  const close = parseFloat(raw[4]);
  const volume = parseFloat(raw[5]);
  const takerBuyVolume = parseFloat(raw[9]);

  // Точная общая дельта свечи (taker buy = ask, остальное = bid)
  const ask = takerBuyVolume;
  const bid = Math.max(0, volume - takerBuyVolume);
  const delta = ask - bid;

  // Один синтетический "сводный" кластер на свечу (нет данных по уровням).
  // Будет заменён настоящими кластерами на Этапе 7.
  const midPrice = alignDown((high + low) / 2, tickSize);
  const cluster: Cluster = {
    price: midPrice,
    bid,
    ask,
    vol: volume,
    delta,
  };

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    delta,
    vpoc_price: midPrice,
    max_vol: volume,
    delta_at_low: 0,
    delta_at_high: 0,
    clusters: [cluster],
  };
}

// ============================================================================
// Главная функция: загрузка периода с пагинацией
// ============================================================================

export async function fetchBinanceKlines(options: FetchOptions = {}): Promise<Dataset> {
  const symbol = options.symbol ?? 'BTCUSDT';
  const days = options.days ?? 5;
  const tickSize = options.tickSize ?? 5;
  const signal = options.signal;

  // Берём окно [now - days; alignedNow], выравненное на 5m сетку.
  const now = Date.now();
  const alignedEnd = alignDown(now, MS_5M);
  const startTime = alignedEnd - days * 24 * 60 * 60 * 1000;
  const totalExpected = Math.ceil((alignedEnd - startTime) / MS_5M);

  const all: Candle5m[] = [];
  let cursor = startTime;

  // Пагинация вперёд: повторяем пока не получим всё окно или пустой ответ.
  while (cursor < alignedEnd && all.length < totalExpected + 100) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const fetchOpts: BatchRequest = {
      symbol,
      interval: '5m',
      startTime: cursor,
      endTime: alignedEnd,
      limit: BATCH_LIMIT,
    };
    if (signal) fetchOpts.signal = signal;
    const batch = await fetchBatch(fetchOpts);

    if (batch.length === 0) break;

    for (const raw of batch) {
      all.push(klineToCandle5m(raw, tickSize));
    }

    options.onProgress?.(all.length, totalExpected);

    const lastRaw = batch[batch.length - 1];
    if (!lastRaw) break;
    const lastTs = lastRaw[0];
    cursor = lastTs + MS_5M;

    // Если пришло меньше лимита — больше данных не будет.
    if (batch.length < BATCH_LIMIT) break;
  }

  // На всякий случай — дедупликация по timestamp + сортировка.
  const dedupMap = new Map<number, Candle5m>();
  for (const c of all) dedupMap.set(c.timestamp, c);
  const candles = [...dedupMap.values()].sort((a, b) => a.timestamp - b.timestamp);

  const meta: DatasetMeta = {
    symbol,
    exchange: 'binance',
    timeframe: '5m',
    tick_size: tickSize,
    from: new Date(candles[0]?.timestamp ?? startTime).toISOString(),
    to: new Date((candles[candles.length - 1]?.timestamp ?? alignedEnd) + MS_5M).toISOString(),
    candles_count: candles.length,
    generated_at: new Date().toISOString(),
    source: 'binance-klines-rest',
    version: 1,
  };

  return { meta, candles };
}
