/**
 * Сохранённые результаты оптимизатора — хранятся в localStorage.
 *
 * Полный BacktestReport не сохраняем (trades могут весить много). Берём
 * только summary для отображения в таблице. Параметры (bt/smc/data)
 * сохраняем полностью — их можно "Применить" в любой момент.
 */

import type { BacktestReport, BacktestSettings } from '@/backtest/types';
import type { SmcLayers, SmcOptions } from '@/engine/smc/types';
import type { TfPairId } from '@/types';
import type { OptimizerMetric, OptimizerResult, OptimizerSettings, OptimizerSpecs } from './types';
import { DEFAULT_OPTIMIZER_SETTINGS } from './types';

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
  /**
   * Торговая пара на момент оптимизации (например BTCUSDT).
   * Optional для backward-compat с записями до 1.36.1.
   */
  symbol?: string;
  /**
   * TF-пара (single или HTF→LTF) на момент оптимизации.
   * Optional для backward-compat с записями до 1.36.1.
   */
  tfPairId?: TfPairId;
  /**
   * Включённые SMC-слои на момент прогона (FVG/Liq/Structure/OB/BB/RB).
   * Optional для backward-compat с записями до 1.39.2.
   *
   * Без этого поля «Применить» не восстанавливал layer-toggles → SMC-overlay
   * считался с тем что было активно у пользователя сейчас → другие зоны →
   * другие сделки. ОЧЕНЬ часто давало разные результаты для одних и тех же
   * params (smcParams ≠ smcLayers!).
   */
  smcLayers?: SmcLayers;
  /**
   * Размер окна на момент прогона: null = 7д prebuilt, число = extended
   * candle count (10000 = 35д, 25000 = 87д и т.д.).
   * Optional для backward-compat с записями до 1.45.2.
   * Без него в Saved-таблице непонятно: 7-дневный это результат или 87д —
   * винрейт между ними может отличаться на десятки процентов.
   */
  currentScope?: number | null;
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
    const parsed = JSON.parse(raw) as OptimizerSettings;
    // Forward-compat: если в новой версии добавились SmcKey/BacktestKey/DataKey
    // которых в сохранённых defaults НЕТ — мержим из DEFAULT_OPTIMIZER_SETTINGS,
    // иначе ParamRow упадёт на `spec.enabled` undefined. Сохранённые значения
    // юзера приоритетней дефолта.
    const mergedSpecs = { ...DEFAULT_OPTIMIZER_SETTINGS.specs } as OptimizerSpecs;
    if (parsed.specs && typeof parsed.specs === 'object') {
      for (const key of Object.keys(parsed.specs) as (keyof OptimizerSpecs)[]) {
        if (mergedSpecs[key] && parsed.specs[key]) {
          mergedSpecs[key] = parsed.specs[key];
        }
      }
    }
    return {
      ...DEFAULT_OPTIMIZER_SETTINGS,
      ...parsed,
      specs: mergedSpecs,
    };
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
  source?: {
    symbol?: string;
    tfPairId?: TfPairId;
    smcLayers?: SmcLayers;
    /**
     * Активная extended-выборка на момент сохранения. null означает 7д
     * prebuilt (важно отличать от undefined — legacy запись без поля).
     */
    currentScope?: number | null;
  },
): SavedResult {
  const r: BacktestReport = result.report;
  // exactOptionalPropertyTypes=true → опциональные поля не должны явно
  // равняться undefined; либо включаем поле со значением, либо опускаем.
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
    ...(source?.symbol !== undefined ? { symbol: source.symbol } : {}),
    ...(source?.tfPairId !== undefined ? { tfPairId: source.tfPairId } : {}),
    ...(source?.smcLayers !== undefined ? { smcLayers: source.smcLayers } : {}),
    ...(source?.currentScope !== undefined ? { currentScope: source.currentScope } : {}),
  };
}
