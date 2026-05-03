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
/** v2 добавляет store 'visionDays' для кэша aggTrades-агрегатов. */
const DB_VERSION = 2;
const STORE_POI = 'poi';
const STORE_VISION = 'visionDays';

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
