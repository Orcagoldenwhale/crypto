/**
 * Лёгкая загрузка последних N свечей 5m через REST `/api/v3/klines`.
 *
 * Используется при включении Live-режима как «pre-load свежей истории»:
 * пользователь должен видеть последние ~24 часа с реальной ценой ещё ДО того,
 * как WebSocket пришлёт первый тик.
 *
 * В отличие от полнокровного `fetchBinanceKlines`:
 *   • один запрос (≤1000 свечей);
 *   • без прогресса и без построения Dataset/meta;
 *   • без кластеров (передаём `clusters: []`) — footprint там
 *     просто не нарисуется, что нормально: каждая закрывающаяся
 *     live-свеча с настоящими aggTrades-кластерами потом вытеснит
 *     «голую» klines-свечу через mergeRaw5mWithLive.
 */

import type { Candle5m, Volume } from '@/types';

const BINANCE_REST = 'https://api.binance.com/api/v3/klines';
const MS_5M = 5 * 60 * 1000;
const MAX_LIMIT = 1000;

export interface FetchRecentKlinesOptions {
  symbol: string;
  /** Сколько последних 5m свечей подгрузить (по умолчанию 288 = 24 часа). */
  limit?: number;
  /** Не включать ли последнюю свечу, если она ещё не закрыта (по умолчанию true). */
  excludeOpen?: boolean;
  /** AbortSignal для отмены запроса. */
  signal?: AbortSignal;
  /** fetch для DI в тестах. */
  fetchImpl?: typeof fetch;
}

/**
 * Загружает последние N 5m-свечей.
 *
 * Защита от двойной свечи:
 *   • Если `excludeOpen=true` (default) — выкидываем свечу с timestamp,
 *     совпадающим с текущим открытым 5m-слотом (`floor(now/5m)*5m`).
 *     Иначе её `close` будет равен открытию (это последний пришедший
 *     kline, ещё не финализированный) — и потом WS-стрим заполнит
 *     эту же свечу настоящими данными, что приведёт к разрыву цены.
 */
export async function fetchRecentKlines5m(
  opts: FetchRecentKlinesOptions,
): Promise<Candle5m[]> {
  const limit = Math.min(opts.limit ?? 288, MAX_LIMIT);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${BINANCE_REST}?symbol=${encodeURIComponent(opts.symbol)}&interval=5m&limit=${limit}`;

  const requestInit: RequestInit = opts.signal ? { signal: opts.signal } : {};
  let resp: Response;
  try {
    resp = await fetchImpl(url, requestInit);
  } catch (e) {
    // TypeError: Failed to fetch / NetworkError / CORS — оборачиваем в
    // понятное сообщение с пометкой что это сетевая проблема.
    const msg = (e as Error).message ?? String(e);
    throw new Error(`klines network error: ${msg}`);
  }
  if (!resp.ok) {
    // 429/418/451/418 — пробуем достать тело для диагностики.
    let detail = '';
    try {
      const body = (await resp.json()) as unknown;
      if (body && typeof body === 'object' && 'msg' in body) {
        detail = ` (${(body as { msg: unknown }).msg})`;
      }
    } catch {
      /* body не JSON, ничего */
    }
    throw new Error(`klines HTTP ${resp.status}${detail}`);
  }

  let raw: unknown;
  try {
    raw = await resp.json();
  } catch (e) {
    throw new Error(`klines bad JSON: ${(e as Error).message ?? 'parse failed'}`);
  }

  // Binance возвращает ОБЪЕКТ {code:-1121, msg:"Invalid symbol"} вместо массива
  // при ошибке валидации параметров. До этой проверки оно тихо превращалось
  // в [] через parseKlinesArray — пользователь не видел причину.
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'msg' in raw) {
    const errObj = raw as { msg?: unknown; code?: unknown };
    throw new Error(
      `klines error: ${String(errObj.msg)}${errObj.code ? ` (code ${String(errObj.code)})` : ''}`,
    );
  }

  const candles = parseKlinesArray(raw);

  if (opts.excludeOpen !== false) {
    const currentSlot = Math.floor(Date.now() / MS_5M) * MS_5M;
    return candles.filter((c) => c.timestamp < currentSlot);
  }
  return candles;
}

// ============================================================================
// Парсинг
// ============================================================================

/**
 * Распарсить массив klines в Candle5m[].
 *
 * Формат kline (12 элементов): [openTime, o, h, l, c, vol, closeTime, quoteVol,
 * tradeCount, takerBuyBase, takerBuyQuote, ignore].
 *
 * delta = ask - bid = takerBuy - (total - takerBuy) = 2*takerBuy - total.
 * Кластеры пустые — footprint на этих свечах не работает, но цена и
 * сумма дельты — точные.
 */
export function parseKlinesArray(raw: unknown): Candle5m[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle5m[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 11) continue;
    const openTime = num(item[0]);
    const open = numStr(item[1]);
    const high = numStr(item[2]);
    const low = numStr(item[3]);
    const close = numStr(item[4]);
    const vol = numStr(item[5]) as Volume;
    const takerBuy = numStr(item[9]) as Volume;
    if (
      !Number.isFinite(openTime) ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(vol) ||
      !Number.isFinite(takerBuy)
    ) {
      continue;
    }
    const delta = 2 * takerBuy - vol;
    out.push({
      timestamp: openTime,
      open,
      high,
      low,
      close,
      volume: vol,
      delta,
      // Без кластеров — footprint на этих свечах не отрисуется.
      vpoc_price: (high + low) / 2,
      max_vol: 0,
      delta_at_low: 0,
      delta_at_high: 0,
      clusters: [],
    });
  }
  return out;
}

function num(x: unknown): number {
  return typeof x === 'number' ? x : NaN;
}
function numStr(x: unknown): number {
  return typeof x === 'string' ? Number.parseFloat(x) : typeof x === 'number' ? x : NaN;
}
