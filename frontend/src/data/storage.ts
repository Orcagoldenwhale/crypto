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
 */
const DB_VERSION = 3;
const STORE_POI = 'poi';
const STORE_VISION = 'visionDays';
const STORE_LIVE_TAIL = 'liveTail';
const STORE_LIVE_META = 'liveMeta';

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
