/**
 * Persistence для POI-зон через IndexedDB (обёртка `idb`).
 *
 * Зоны хранятся отдельно для каждого тикера, чтобы при смене символа
 * пользователь видел свою старую разметку именно для этого инструмента.
 *
 * Все методы — async, операции под капотом отрабатывают за миллисекунды,
 * так что для дебаунса нет необходимости (мы вызываем save после каждого
 * пользовательского действия — создания/удаления зоны).
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Candle5m, POIZone } from '@/types';

const DB_NAME = 'smc-backtester';
/**
 * Версии:
 *   v1 — store 'poi'.
 *   v2 — добавляет store 'visionDays' (кэш aggTrades-агрегатов).
 *   v3 — добавляет 'liveTail' (закрытые live-свечи) и 'liveMeta'
 *        (`lastAggTradeId` для gap recovery после reload).
 *   v4 — добавляет 'extendedDatasets' (готовые pre-regrouped 5m свечи
 *        для расширенного бэктеста; ключ symbol+days+mult).
 *   v5 — инвалидирует 'visionDays' и 'extendedDatasets': до 1.37.3 парсер
 *        Vision сохранял свечи с μs-timestamps (год +058332) для символов,
 *        где Binance мигрировал CSV-формат. Чистим кэш — на следующем
 *        прогоне перекачается правильно. Зоны (`poi`) и live-свечи не
 *        задеты.
 *   v6 — инвалидирует 'visionDays' и 'extendedDatasets': до 1.43.1 в
 *        visionLoader сидел хардкод-словарь DEFAULT_TICK_SIZE, рассинхрон-
 *        ный с `symbols.ts` (BTC: 0.1 vs 5, ETH: 0.01 vs 0.5, TON просто
 *        отсутствовал и фолбэчился на 0.1 — для $5-токена это 2% бакеты,
 *        кластеры превращались в кашу, 4-правильный сигнал не срабатывал,
 *        extended-бэктест на 35+ днях выдавал 0 сделок). Сейчас tickSize
 *        приходит из `symbols.ts` явно. Сбрасываем кэш → перекачаем с
 *        правильной сеткой.
 */
const DB_VERSION = 6;
const STORE_POI = 'poi';
const STORE_VISION = 'visionDays';
const STORE_LIVE_TAIL = 'liveTail';
const STORE_LIVE_META = 'liveMeta';
const STORE_EXTENDED = 'extendedDatasets';

interface SmcDB extends DBSchema {
  poi: {
    /** Ключ — символ (BTCUSDT, ETHUSDT, ...) */
    key: string;
    value: {
      symbol: string;
      zones: POIZone[];
      updatedAt: number;
    };
  };
  visionDays: {
    /** Ключ — `${symbol}:${date YYYY-MM-DD}` */
    key: string;
    value: {
      key: string;
      symbol: string;
      date: string;
      candles: Candle5m[];
      cachedAt: number;
    };
  };
  liveTail: {
    /** Ключ — символ. Хранит хвост последних закрытых live-свечей. */
    key: string;
    value: {
      symbol: string;
      candles: Candle5m[];
      updatedAt: number;
    };
  };
  liveMeta: {
    /** Ключ — символ. Метаданные для gap-recovery. */
    key: string;
    value: {
      symbol: string;
      lastAggTradeId: number;
      lastTimestamp: number;
      updatedAt: number;
    };
  };
  extendedDatasets: {
    /** Ключ — `${symbol}:${days}:${mult}` (например `BTCUSDT:174:1`). */
    key: string;
    value: {
      key: string;
      symbol: string;
      days: number;
      mult: number;
      /** Готовые pre-regrouped 5m свечи с кластерами. */
      candles: Candle5m[];
      cachedAt: number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<SmcDB>> | null = null;

function getDB(): Promise<IDBPDatabase<SmcDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SmcDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(STORE_POI)) {
          db.createObjectStore(STORE_POI, { keyPath: 'symbol' });
        }
        if (oldVersion < 2 && !db.objectStoreNames.contains(STORE_VISION)) {
          db.createObjectStore(STORE_VISION, { keyPath: 'key' });
        }
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains(STORE_LIVE_TAIL)) {
            db.createObjectStore(STORE_LIVE_TAIL, { keyPath: 'symbol' });
          }
          if (!db.objectStoreNames.contains(STORE_LIVE_META)) {
            db.createObjectStore(STORE_LIVE_META, { keyPath: 'symbol' });
          }
        }
        if (oldVersion < 4 && !db.objectStoreNames.contains(STORE_EXTENDED)) {
          db.createObjectStore(STORE_EXTENDED, { keyPath: 'key' });
        }
        if (oldVersion < 5) {
          // Битые μs-timestamp данные — drop+recreate чистит весь кэш Vision.
          // На следующем прогоне юзер скачает заново (минуты на BTC 7д,
          // часы на BNB 35д — но получит корректные даты и сделки).
          if (db.objectStoreNames.contains(STORE_VISION)) {
            db.deleteObjectStore(STORE_VISION);
          }
          db.createObjectStore(STORE_VISION, { keyPath: 'key' });
          if (db.objectStoreNames.contains(STORE_EXTENDED)) {
            db.deleteObjectStore(STORE_EXTENDED);
          }
          db.createObjectStore(STORE_EXTENDED, { keyPath: 'key' });
        }
        if (oldVersion < 6) {
          // Тот же drop+recreate, причина другая: тики были посчитаны с
          // неправильной сеткой (см. docстроку DB_VERSION выше).
          if (db.objectStoreNames.contains(STORE_VISION)) {
            db.deleteObjectStore(STORE_VISION);
          }
          db.createObjectStore(STORE_VISION, { keyPath: 'key' });
          if (db.objectStoreNames.contains(STORE_EXTENDED)) {
            db.deleteObjectStore(STORE_EXTENDED);
          }
          db.createObjectStore(STORE_EXTENDED, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

/** Загружает POI-зоны для символа. Возвращает [] если ничего нет или IndexedDB недоступен. */
export async function loadPOIs(symbol: string): Promise<POIZone[]> {
  try {
    const db = await getDB();
    const record = await db.get(STORE_POI, symbol);
    return record?.zones ?? [];
  } catch (e) {
    console.warn('[storage] loadPOIs failed:', e);
    return [];
  }
}

/** Сохраняет POI-зоны для символа. */
export async function savePOIs(symbol: string, zones: POIZone[]): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_POI, {
      symbol,
      zones,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[storage] savePOIs failed:', e);
  }
}

/** Очищает все POI-зоны для символа. */
export async function clearPOIs(symbol: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_POI, symbol);
  } catch (e) {
    console.warn('[storage] clearPOIs failed:', e);
  }
}

// ============================================================================
// Vision-дни (агрегированные 5m-свечи с настоящими кластерами)
// ============================================================================

function visionKey(symbol: string, date: string): string {
  return `${symbol}:${date}`;
}

/** Загружает свечи за один UTC-день из кэша. Возвращает null, если кэша нет. */
export async function loadVisionDay(symbol: string, date: string): Promise<Candle5m[] | null> {
  try {
    const db = await getDB();
    const record = await db.get(STORE_VISION, visionKey(symbol, date));
    return record?.candles ?? null;
  } catch (e) {
    console.warn('[storage] loadVisionDay failed:', e);
    return null;
  }
}

/** Сохраняет свечи за один UTC-день в кэш. */
export async function saveVisionDay(
  symbol: string,
  date: string,
  candles: Candle5m[],
): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_VISION, {
      key: visionKey(symbol, date),
      symbol,
      date,
      candles,
      cachedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[storage] saveVisionDay failed:', e);
  }
}

// ============================================================================
// Extended datasets — pre-regrouped полные выборки для расширенного бэктеста
//
// Зачем отдельный store, если уже есть `visionDays`: `visionDays` хранит сырые
// 5m свечи по дням. Чтобы получить готовый Candle5m[] на N дней, нужно
// прочитать M записей (по дню каждая) + сделать regroupCandles. На 174 днях
// это 10-30 сек чистого IndexedDB-read'а. Здесь же — один read, мгновенно.
//
// Размер: 50k свечей × ~5KB на свечу (~50 кластеров) ≈ 250 MB. Может упереться
// в quota — операция graceful: writes ловят ошибку и логируют warn, дальше
// просто фолбэк на medlennый путь.
// ============================================================================

function extendedKey(symbol: string, days: number, mult: number): string {
  return `${symbol}:${days}:${mult}`;
}

/** Загружает готовый pre-regrouped датасет. Возвращает null если кэша нет. */
export async function loadExtendedDataset(
  symbol: string,
  days: number,
  mult: number,
): Promise<Candle5m[] | null> {
  try {
    const db = await getDB();
    const record = await db.get(STORE_EXTENDED, extendedKey(symbol, days, mult));
    return record?.candles ?? null;
  } catch (e) {
    console.warn('[storage] loadExtendedDataset failed:', e);
    return null;
  }
}

/** Сохраняет готовый pre-regrouped датасет. */
export async function saveExtendedDataset(
  symbol: string,
  days: number,
  mult: number,
  candles: readonly Candle5m[],
): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_EXTENDED, {
      key: extendedKey(symbol, days, mult),
      symbol,
      days,
      mult,
      candles: candles as Candle5m[],
      cachedAt: Date.now(),
    });
  } catch (e) {
    // Quota exceeded — не критично, в следующий раз пересчитаем из daily-cache.
    console.warn('[storage] saveExtendedDataset failed (quota?):', e);
  }
}

// ============================================================================
// Live tail + meta (для real-time режима, см. docs/04-live-mode.md)
// ============================================================================

export interface LiveMeta {
  symbol: string;
  /** Последний обработанный aggTradeId — для gap-recovery после reload/reconnect. */
  lastAggTradeId: number;
  /** Timestamp последнего применённого тика (Unix ms). */
  lastTimestamp: number;
}

/** Загрузить хвост live-свечей для символа. */
export async function loadLiveTail(symbol: string): Promise<Candle5m[]> {
  try {
    const db = await getDB();
    const rec = await db.get(STORE_LIVE_TAIL, symbol);
    return rec?.candles ?? [];
  } catch (e) {
    console.warn('[storage] loadLiveTail failed:', e);
    return [];
  }
}

/**
 * Сохранить хвост live-свечей.
 *
 * Хвост ограничивается 500 свечами (≈ 41 час 5m) — это безопасный буфер
 * на случай длительного оффлайна, но не раздувает БД.
 */
export async function saveLiveTail(symbol: string, candles: Candle5m[]): Promise<void> {
  try {
    const trimmed = candles.length > 500 ? candles.slice(-500) : candles;
    const db = await getDB();
    await db.put(STORE_LIVE_TAIL, {
      symbol,
      candles: trimmed,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[storage] saveLiveTail failed:', e);
  }
}

/** Очистить live-хвост для символа (например, по кнопке «Сбросить live»). */
export async function clearLiveTail(symbol: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(STORE_LIVE_TAIL, symbol);
  } catch (e) {
    console.warn('[storage] clearLiveTail failed:', e);
  }
}

/** Загрузить метаданные live (для gap-recovery после reload). */
export async function loadLiveMeta(symbol: string): Promise<LiveMeta | null> {
  try {
    const db = await getDB();
    const rec = await db.get(STORE_LIVE_META, symbol);
    if (!rec) return null;
    return {
      symbol: rec.symbol,
      lastAggTradeId: rec.lastAggTradeId,
      lastTimestamp: rec.lastTimestamp,
    };
  } catch (e) {
    console.warn('[storage] loadLiveMeta failed:', e);
    return null;
  }
}

/** Сохранить метаданные live. */
export async function saveLiveMeta(meta: LiveMeta): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_LIVE_META, {
      symbol: meta.symbol,
      lastAggTradeId: meta.lastAggTradeId,
      lastTimestamp: meta.lastTimestamp,
      updatedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[storage] saveLiveMeta failed:', e);
  }
}
