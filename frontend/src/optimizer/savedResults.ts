/**
 * Сохранённые результаты оптимизатора — хранятся в localStorage.
 *
 * Полный BacktestReport не сохраняем (trades могут весить много). Берём
 * только summary для отображения в таблице. Параметры (bt/smc/data)
 * сохраняем полностью — их можно "Применить" в любой момент.
 */

import type { BacktestReport, BacktestSettings } from '@/backtest/types';
import type { SmcOptions } from '@/engine/smc/types';
import type { OptimizerMetric, OptimizerResult, OptimizerSettings } from './types';

export interface SavedResultSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  openTrades: number;
  winRate: number;
  totalPnlR: number;
  avgPnlR: number;
  maxConsecutiveLosses: number;
}

export interface SavedResult {
  /** Уникальный id (timestamp+random). */
  id: string;
  /** Unix-ms сохранения. */
  savedAt: number;
  /** Метрика, по которой ранжировалось. */
  metric: OptimizerMetric;
  /** Значение метрики. */
  score: number;
  btParams: Partial<BacktestSettings>;
  smcParams: Partial<SmcOptions>;
  dataParams: { tickMultiplier?: number };
  summary: SavedResultSummary;
  /** Опциональная пользовательская подпись. */
  note?: string;
}

const STORAGE_KEY = 'smc-optimizer-saved-results-v1';

export function loadSaved(): SavedResult[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data as SavedResult[];
  } catch {
    return [];
  }
}

export function persistSaved(items: readonly SavedResult[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota / SSR — игнорируем.
  }
}

// ============================================================================
// Дефолтная конфигурация оптимизатора — сохраняется отдельно от results.
// ============================================================================

const DEFAULTS_KEY = 'smc-optimizer-defaults-v1';

export function loadOptimizerDefaults(): OptimizerSettings | null {
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OptimizerSettings;
  } catch {
    return null;
  }
}

export function persistOptimizerDefaults(settings: OptimizerSettings): void {
  try {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(settings));
  } catch {
    // Quota / SSR.
  }
}

/** Конвертирует OptimizerResult в SavedResult (для записи). */
export function snapshotResult(
  result: OptimizerResult,
  metric: OptimizerMetric,
): SavedResult {
  const r: BacktestReport = result.report;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
    metric,
    score: result.score,
    btParams: result.btParams,
    smcParams: result.smcParams,
    dataParams: result.dataParams,
    summary: {
      totalTrades: r.totalTrades,
      wins: r.wins,
      losses: r.losses,
      openTrades: r.openTrades,
      winRate: r.winRate,
      totalPnlR: r.totalPnlR,
      avgPnlR: r.avgPnlR,
      maxConsecutiveLosses: r.maxConsecutiveLosses,
    },
  };
}
