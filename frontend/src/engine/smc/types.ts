/**
 * Типы SMC-оверлея (этап 1: FVG + Liquidity).
 *
 * Все зоны — чисто геометрические описания того, что должно появиться поверх
 * свечей. Детекторы (см. detectFvg.ts / detectLiquidity.ts) возвращают эти
 * типы, рендер (render.ts) их рисует. Сами свечи и время хранятся через
 * `TimestampMs` чтобы зона корректно ехала вместе с pan/zoom.
 */

import type { Price, TimestampMs } from '@/types';

/** Общий ID — генерируется детектором, стабилен в пределах одного прогона. */
export type SmcZoneId = string;

// ============================================================================
// FVG (Fair Value Gap) — 3-свечный ценовой разрыв
// ============================================================================

export interface FvgZone {
  id: SmcZoneId;
  /** 'bull' = разрыв вверх (поддержка); 'bear' = разрыв вниз (сопротивление). */
  kind: 'bull' | 'bear';
  /** Время свечи №1 в тройке (левая граница зоны по X). */
  startTime: TimestampMs;
  /**
   * Время, до которого живёт зона:
   *   - если зона ещё не закрыта — последняя видимая свеча (расширяется в будущее);
   *   - если закрыта — момент первой свечи, которая пробила её mitigation-уровень.
   */
  endTime: TimestampMs;
  /** Нижняя цена зоны. */
  minPrice: Price;
  /** Верхняя цена зоны. */
  maxPrice: Price;
  /**
   * true = зона ещё не «отработана» (цена не возвращалась внутрь).
   * false = зона уже протестирована — рисуем тусклее.
   */
  unmitigated: boolean;
}

// ============================================================================
// Liquidity — equal-highs / equal-lows + sweeps
// ============================================================================

/**
 * Скопление ликвидности — два или более swing-points с близкими ценами.
 *
 * Двойная вершина / тройное дно и т.п. рисуются горизонтальной линией
 * на средней цене этих swing-points. Линия живёт от первого swing до:
 *   - последней видимой свечи, пока не было sweep'а;
 *   - первого sweep'а — после этого помечаем как «снято».
 */
export interface LiquidityZone {
  id: SmcZoneId;
  /** 'high' (equal highs, бычья ловушка) | 'low' (equal lows, медвежья). */
  kind: 'high' | 'low';
  /** Цена линии (среднее по equal-points). */
  price: Price;
  /** Время первого swing-point в группе. */
  startTime: TimestampMs;
  /** Время последней свечи, до которой расширяется линия. */
  endTime: TimestampMs;
  /** Сколько касаний у уровня (>= 2). */
  touches: number;
  /**
   * Было ли уже снятие ликвидности (sweep): свеча пробила уровень и
   * закрылась обратно. Если есть — рисуем как «снятая ловушка».
   */
  sweep: SweepEvent | null;
}

export interface SweepEvent {
  /** Время свечи, которая сделала sweep. */
  time: TimestampMs;
  /** Экстремум этой свечи (high для kind=high, low для kind=low). */
  extremum: Price;
}

// ============================================================================
// Опции и слои
// ============================================================================

/**
 * Параметры детекторов (минимальная панель).
 *
 * - lookback — окно слева/справа для определения swing-point (по умолчанию 5);
 * - equalityTolerancePct — допустимая разница между equal-highs/lows как доля
 *   от цены (0.0005 = 0.05% — типично для крипты на 15m/1h);
 * - hideMitigatedFvg — прятать ли уже отработанные FVG.
 */
export interface SmcOptions {
  lookback: number;
  equalityTolerancePct: number;
  hideMitigatedFvg: boolean;
}

/** Видимость каждого слоя (тогглы из Toolbox). */
export interface SmcLayers {
  fvg: boolean;
  liquidity: boolean;
}

/** Результат расчёта — ровно то, что отрендерится поверх свечей. */
export interface SmcOverlay {
  fvgs: readonly FvgZone[];
  liquidity: readonly LiquidityZone[];
}

export const EMPTY_SMC_OVERLAY: SmcOverlay = Object.freeze({
  fvgs: [],
  liquidity: [],
});

export const DEFAULT_SMC_OPTIONS: SmcOptions = Object.freeze({
  lookback: 5,
  equalityTolerancePct: 0.0005,
  hideMitigatedFvg: false,
});

export const DEFAULT_SMC_LAYERS: SmcLayers = Object.freeze({
  fvg: true,
  liquidity: true,
});
