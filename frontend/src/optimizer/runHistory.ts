/**
 * История прогонов оптимизатора — хранится в localStorage.
 *
 * В историю автоматически попадает каждый run: завершённый, на паузе или
 * прерванный (с накопленными результатами). На паузе сохраняется ещё и
 * "хвост" комбинаций, чтобы прогон можно было возобновить.
 *
 * Размер ограничен MAX_ENTRIES — старые записи вытесняются.
 */

import type { TfPairId } from '@/types';
import type { SmcLayers } from '@/engine/smc/types';
import type { Combo } from './generateGrid';
import type { OptimizerResult, OptimizerSettings } from './types';

export type RunStatus = 'completed' | 'paused' | 'cancelled';

export interface RunHistoryEntry {
  id: string;
  startedAt: number;
  /** null для paused и для незавершённых cancelled. */
  finishedAt: number | null;
  status: RunStatus;
  optSettings: OptimizerSettings;
  totalCombos: number;
  doneIndex: number;
  /** Топ-N собранный к моменту записи. trades в report обнулены. */
  results: OptimizerResult[];
  /**
   * @deprecated Legacy-поле для записей, созданных до v1.36.0.
   * Новые paused-записи НЕ пишут это поле (сериализация миллионов
   * комбо превышала localStorage quota). Resume теперь регенерирует
   * грид из `optSettings.specs` + `doneIndex` — детерминированно.
   */
  remainingCombos?: Combo[];
  /** Пользовательская подпись (опц.). */
  label?: string;
  /**
   * Торговая пара на момент прогона (например BTCUSDT).
   * Optional для backward-compat с записями до 1.36.1.
   */
  symbol?: string;
  /**
   * TF-пара (single или HTF→LTF) на момент прогона.
   * Optional для backward-compat с записями до 1.36.1.
   */
  tfPairId?: TfPairId;
  /**
   * Включённые SMC-слои на момент прогона. Optional для backward-compat
   * с записями до 1.39.2. См. SavedResult.smcLayers — та же мотивация.
   */
  smcLayers?: SmcLayers;
}

const STORAGE_KEY = 'smc-optimizer-history-v1';
const MAX_ENTRIES = 50;

export function loadHistory(): RunHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as RunHistoryEntry[];
  } catch {
    return [];
  }
}

export function persistHistory(items: readonly RunHistoryEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota — попробуем ужать массив вдвое и записать.
    try {
      const half = items.slice(0, Math.max(1, Math.floor(items.length / 2)));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(half));
    } catch {
      /* nothing more we can do */
    }
  }
}

export function addHistoryEntry(
  prev: readonly RunHistoryEntry[],
  entry: RunHistoryEntry,
): RunHistoryEntry[] {
  // Новые — в начало, обрезка хвоста.
  const next = [entry, ...prev].slice(0, MAX_ENTRIES);
  persistHistory(next);
  return next;
}

export function removeHistoryEntry(
  prev: readonly RunHistoryEntry[],
  id: string,
): RunHistoryEntry[] {
  const next = prev.filter((e) => e.id !== id);
  persistHistory(next);
  return next;
}

/**
 * Срезает массив trades из BacktestReport — он самый тяжёлый,
 * а для отображения в истории не нужен (есть summary).
 */
export function slimResult(r: OptimizerResult): OptimizerResult {
  return {
    ...r,
    report: { ...r.report, trades: [] },
  };
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
