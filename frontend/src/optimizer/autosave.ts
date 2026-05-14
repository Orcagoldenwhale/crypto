/**
 * Autosave прогрессa оптимизатора в localStorage.
 *
 * Зачем: History сохраняет запись только в трёх случаях — completed / pause /
 * cancelled. Если прогон оборвался без явного клика (краш вкладки, OOM, спящий
 * Mac, случайный reload), вся работа теряется. Autosave пишет состояние
 * каждые ~CHUNK_SIZE комбо прямо в localStorage; при следующем открытии
 * оптимизатора показывается баннер «Найден прерванный прогон, возобновить?».
 *
 * Хранится ровно одна запись — `STORAGE_KEY` глобален, не array. Новый
 * чекпойнт затирает старый. После явного pause/cancel/complete запись
 * чистится (`clearAutosave`), чтобы не дублироваться с History.
 *
 * Размер: top-N результатов через `slimResult` (без массива trades) — ~5KB
 * на 20 результатов. Запись синхронная (~0.5ms на 5KB), не блокирует UI.
 */

import type { TfPairId } from '@/types';
import type { SmcLayers } from '@/engine/smc/types';
import type { OptimizerResult, OptimizerSettings } from './types';

const STORAGE_KEY = 'smc-optimizer-autosave-v1';

/**
 * Через сколько мс autosave считается устаревшим. Если юзер не открывал
 * оптимизатор два дня — не воскрешаем прогон автоматически, скорее всего
 * данные уже не актуальны или забыты.
 */
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export interface AutosaveEntry {
  /** Unix-ms старта прогона. */
  startedAt: number;
  /** Unix-ms последнего чекпойнта (для проверки staleness). */
  updatedAt: number;
  /** Сколько combos обработано. Resume стартует с этого индекса. */
  processed: number;
  /** Всего combos в грид. */
  totalCombos: number;
  /** Top-N накоплённый к моменту чекпойнта (trades в report обнулены). */
  top: OptimizerResult[];
  /** Полные настройки оптимизатора (metric / topN / specs). */
  optSettings: OptimizerSettings;
  /** Символ на момент старта прогона. */
  symbol: string;
  /** TF-пара на момент старта. */
  tfPairId: TfPairId;
  /** SMC-слои на момент старта. */
  smcLayers: SmcLayers;
  /**
   * Активная extended-выборка. null = на 7д prebuilt. Resume требует
   * того же scope (если отличается — App.tsx должен сначала загрузить нужное
   * окно через handleChangeOptimizerScope).
   */
  currentScope: number | null;
}

export function saveAutosave(entry: AutosaveEntry): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Quota / SSR — autosave best-effort; в памяти прогон продолжается.
  }
}

/**
 * Возвращает autosave-запись или null если её нет / она невалидна / устарела.
 * Устаревшие записи (> STALE_THRESHOLD_MS с последнего чекпойнта) тоже даёт
 * null — пользователь забыл, не оживляем.
 */
export function loadAutosave(): AutosaveEntry | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutosaveEntry>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      typeof parsed.startedAt !== 'number' ||
      typeof parsed.updatedAt !== 'number' ||
      typeof parsed.processed !== 'number' ||
      typeof parsed.totalCombos !== 'number' ||
      !Array.isArray(parsed.top) ||
      !parsed.optSettings ||
      typeof parsed.symbol !== 'string'
    ) {
      return null;
    }
    if (Date.now() - parsed.updatedAt > STALE_THRESHOLD_MS) return null;
    return parsed as AutosaveEntry;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // SSR — игнорируем.
  }
}
