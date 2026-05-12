/**
 * Типы оптимизатора параметров бэктеста.
 *
 * Идея: пользователь выбирает несколько параметров BacktestSettings,
 * задаёт диапазон [from..to] и шаг для числовых или список значений
 * для булевых/енумов. Оптимизатор перебирает декартово произведение
 * комбинаций, прогоняет бэктест на каждом и возвращает топ-N по метрике.
 */

import type { BacktestReport, BacktestSettings } from '@/backtest/types';
import type { SmcOptions } from '@/engine/smc/types';

// ============================================================================
// Метрики
// ============================================================================

export type OptimizerMetric =
  | 'totalPnlR'      // Суммарный P&L в R
  | 'winRate'        // Winrate
  | 'avgPnlR'        // Средний R на сделку
  | 'profitFactor'   // gross_profit / gross_loss
  | 'composite';     // Сбалансированная: totalPnlR × winrate (приоритет стабильности)

export const METRIC_LABEL: Record<OptimizerMetric, string> = {
  totalPnlR: 'P&L (R)',
  winRate: 'Winrate',
  avgPnlR: 'Avg R / trade',
  profitFactor: 'Profit Factor',
  composite: 'Composite (R × WR)',
};

// ============================================================================
// Спецификация параметра
// ============================================================================

/**
 * Все ключи, которые можно варьировать.
 *   - "BT.*"  — поля BacktestSettings (быстрые, общий smcOverlay)
 *   - "SMC.*" — поля SmcOptions (требуют пересчёта overlay; группируем)
 */
export type BacktestKey =
  | 'stopPct'
  | 'rewardRatio'
  | 'zoneGapPct'
  | 'maxReentries'
  | 'minFvgPct'
  | 'maxCandleBodyPct'
  | 'reentryAfterWin'
  | 'slBehindObWick'
  | 'slBehindFvgEdge'
  | 'validityByMt'
  | 'entryPoint';

/**
 * Подмножество SmcOptions, которые имеет смысл варьировать.
 * Эти параметры влияют на детектирование зон, поэтому пересчёт overlay
 * нужен — группируем комбинации по уникальному SMC-подмножеству.
 */
export type SmcKey =
  | 'lookback'
  | 'fvgMaxFillPct'
  | 'obExtraction'
  | 'obUseMeanThreshold'
  | 'obRequireAbsorption'
  | 'obAllowMultiCandle'
  | 'obSearchAtSweep'
  | 'obSearchAtFvg'
  | 'obSearchAtPrevBlock'
  | 'rbWickRatio'
  | 'rbRequireSweep'
  | 'rbAlsoAtFvg'
  | 'rbUseMeanThreshold';

export type OptimizableKey = BacktestKey | SmcKey;

export const SMC_KEYS: ReadonlySet<SmcKey> = new Set<SmcKey>([
  'lookback',
  'fvgMaxFillPct',
  'obExtraction',
  'obUseMeanThreshold',
  'obRequireAbsorption',
  'obAllowMultiCandle',
  'obSearchAtSweep',
  'obSearchAtFvg',
  'obSearchAtPrevBlock',
  'rbWickRatio',
  'rbRequireSweep',
  'rbAlsoAtFvg',
  'rbUseMeanThreshold',
]);

export function isSmcKey(k: OptimizableKey): k is SmcKey {
  return (SMC_KEYS as ReadonlySet<string>).has(k);
}

export interface NumberParamSpec {
  type: 'number';
  enabled: boolean;
  from: number;
  to: number;
  step: number;
}

export interface BoolParamSpec {
  type: 'bool';
  enabled: boolean;
  /** Если true — перебираем оба значения [false, true]. Если false — только текущее. */
  bothValues: boolean;
}

export interface EnumParamSpec<T extends string> {
  type: 'enum';
  enabled: boolean;
  /** Подмножество значений енума, которые включены в перебор. */
  values: readonly T[];
}

export type ParamSpec = NumberParamSpec | BoolParamSpec | EnumParamSpec<string>;

/**
 * Карта спецификаций для всех оптимизируемых параметров.
 * По умолчанию все enabled=false — пользователь сам отметит нужные.
 */
export type OptimizerSpecs = Record<OptimizableKey, ParamSpec>;

// ============================================================================
// Настройки оптимизатора
// ============================================================================

export interface OptimizerSettings {
  specs: OptimizerSpecs;
  metric: OptimizerMetric;
  /** Сколько лучших результатов показать (по умолчанию 20). */
  topN: number;
}

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  metric: 'composite',
  topN: 20,
  specs: {
    // ===== Бэктест =====
    stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.05 },
    rewardRatio: { type: 'number', enabled: true, from: 1, to: 3, step: 0.5 },
    zoneGapPct: { type: 'number', enabled: false, from: 0, to: 30, step: 10 },
    maxReentries: { type: 'number', enabled: false, from: 0, to: 3, step: 1 },
    minFvgPct: { type: 'number', enabled: false, from: 0, to: 0.5, step: 0.1 },
    maxCandleBodyPct: { type: 'number', enabled: false, from: 0, to: 2, step: 0.5 },
    reentryAfterWin: { type: 'bool', enabled: false, bothValues: true },
    slBehindObWick: { type: 'bool', enabled: false, bothValues: true },
    slBehindFvgEdge: { type: 'bool', enabled: false, bothValues: true },
    validityByMt: { type: 'bool', enabled: false, bothValues: true },
    entryPoint: { type: 'enum', enabled: false, values: ['close', 'mt', 'wick'] },
    // ===== SMC =====
    lookback: { type: 'number', enabled: false, from: 3, to: 10, step: 1 },
    fvgMaxFillPct: { type: 'number', enabled: false, from: 30, to: 80, step: 10 },
    obExtraction: { type: 'enum', enabled: false, values: ['wicks', 'body', 'auto'] },
    obUseMeanThreshold: { type: 'bool', enabled: false, bothValues: true },
    obRequireAbsorption: { type: 'bool', enabled: false, bothValues: true },
    obAllowMultiCandle: { type: 'bool', enabled: false, bothValues: true },
    obSearchAtSweep: { type: 'bool', enabled: false, bothValues: true },
    obSearchAtFvg: { type: 'bool', enabled: false, bothValues: true },
    obSearchAtPrevBlock: { type: 'bool', enabled: false, bothValues: true },
    rbWickRatio: { type: 'number', enabled: false, from: 1.5, to: 4, step: 0.5 },
    rbRequireSweep: { type: 'bool', enabled: false, bothValues: true },
    rbAlsoAtFvg: { type: 'bool', enabled: false, bothValues: true },
    rbUseMeanThreshold: { type: 'bool', enabled: false, bothValues: true },
  },
};

// ============================================================================
// Результат
// ============================================================================

export interface OptimizerResult {
  /** Значения варьируемых полей BacktestSettings. */
  btParams: Partial<BacktestSettings>;
  /** Значения варьируемых полей SmcOptions. */
  smcParams: Partial<SmcOptions>;
  /** Полный отчёт бэктеста. */
  report: BacktestReport;
  /** Численная метрика, по которой сортировали. */
  score: number;
}

export interface OptimizerProgress {
  /** Сколько комбинаций уже обработано. */
  done: number;
  /** Сколько всего комбинаций. */
  total: number;
  /** Лучшее текущее значение score. null если пока ничего. */
  bestScore: number | null;
}
