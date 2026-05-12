/**
 * Типы оптимизатора параметров бэктеста.
 *
 * Идея: пользователь выбирает несколько параметров BacktestSettings,
 * задаёт диапазон [from..to] и шаг для числовых или список значений
 * для булевых/енумов. Оптимизатор перебирает декартово произведение
 * комбинаций, прогоняет бэктест на каждом и возвращает топ-N по метрике.
 */

import type { BacktestReport, BacktestSettings } from '@/backtest/types';

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
 * Все ключи `BacktestSettings`, которые можно варьировать в Фазе 1
 * (не требуют пересчёта smcOverlay).
 */
export type OptimizableKey =
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
  /** Лимит на общее число комбинаций — защита от случайного миллиона. */
  maxCombinations: number;
}

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  metric: 'composite',
  topN: 20,
  maxCombinations: 5000,
  specs: {
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
  },
};

// ============================================================================
// Результат
// ============================================================================

export interface OptimizerResult {
  /** Конкретные значения параметров (только тех, что варьировались). */
  params: Partial<BacktestSettings>;
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
