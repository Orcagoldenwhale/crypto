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
 * - hideMitigated — независимые тогглы по каждому слою. true = прятать уже
 *   отработанные элементы:
 *     fvg          → FVG с unmitigated=false (цена возвращалась в зону);
 *     liquidity    → ловушки со sweep!==null (ликвидность снята);
 *     structure    → BOS/CHoCH с retestTime!==null (уровень уже ретестнули);
 *     orderBlocks  → OB с unmitigated=false (цена касалась OB).
 *   Чистит график на длинных историях, оставляя только «живые» сетапы.
 */
export interface SmcHideMitigated {
  fvg: boolean;
  liquidity: boolean;
  structure: boolean;
  orderBlocks: boolean;
}

export interface SmcOptions {
  lookback: number;
  equalityTolerancePct: number;
  hideMitigated: SmcHideMitigated;
}

/** Видимость каждого слоя (тогглы из Toolbox). */
export interface SmcLayers {
  fvg: boolean;
  liquidity: boolean;
  structure: boolean;
  orderBlocks: boolean;
}

/** Результат расчёта — ровно то, что отрендерится поверх свечей. */
export interface SmcOverlay {
  fvgs: readonly FvgZone[];
  liquidity: readonly LiquidityZone[];
  structure: readonly StructureBreak[];
  orderBlocks: readonly OrderBlockZone[];
}

export const EMPTY_SMC_OVERLAY: SmcOverlay = Object.freeze({
  fvgs: [],
  liquidity: [],
  structure: [],
  orderBlocks: [],
});

export const DEFAULT_HIDE_MITIGATED: SmcHideMitigated = Object.freeze({
  fvg: false,
  liquidity: false,
  structure: false,
  orderBlocks: false,
});

export const DEFAULT_SMC_OPTIONS: SmcOptions = Object.freeze({
  lookback: 5,
  equalityTolerancePct: 0.0005,
  hideMitigated: DEFAULT_HIDE_MITIGATED,
});

export const DEFAULT_SMC_LAYERS: SmcLayers = Object.freeze({
  fvg: true,
  liquidity: true,
  structure: true,
  orderBlocks: true,
});

// ============================================================================
// Структурные пробои (CHoCH / BOS) + retest
// ============================================================================

/**
 * Событие нарушения рыночной структуры.
 *
 *   - BOS (Break of Structure) — продолжение тренда:
 *       uptrend, close > предыдущего HH → BOS↑;
 *       downtrend, close < предыдущего LL → BOS↓.
 *
 *   - CHoCH (Change of Character) — разворот тренда:
 *       uptrend, close < последнего HL → CHoCH↓;
 *       downtrend, close > последнего LH → CHoCH↑.
 *
 * Поле `retestTime` — время первой свечи после break, которая коснулась
 * сломанного уровня (low ≤ level для up-break, high ≥ level для down-break).
 * null означает, что цена так и не вернулась к уровню до конца данных.
 */
export interface StructureBreak {
  id: SmcZoneId;
  kind: 'BOS' | 'CHoCH';
  /** Направление пробоя: 'up' = вверх, 'down' = вниз. */
  dir: 'up' | 'down';
  /** Цена swing-уровня, который был сломан close-свечой. */
  level: Price;
  /** Время swing-точки (левая граница линии). */
  levelTime: TimestampMs;
  /** Время свечи, чей close сломал уровень (правая граница без retest). */
  breakTime: TimestampMs;
  /** Время retest-свечи (касание сломанного уровня) или null, если не было. */
  retestTime: TimestampMs | null;
}

// ============================================================================
// Order Blocks
// ============================================================================

/**
 * Order Block — зона интереса от «институционалов».
 *
 * Определяется как ПОСЛЕДНЯЯ противонаправленная свеча перед импульсом,
 * который сломал структуру (см. StructureBreak):
 *   - break↑ → bull OB (последний bearish bar до импульса вверх; теперь это поддержка);
 *   - break↓ → bear OB (последний bullish bar до импульса вниз; теперь это сопротивление).
 *
 * Зона = [low, high] этой свечи. Если между OB и break-свечой есть FVG —
 * это «strong OB» (флаг hasFvg). Mitigation = первое касание зоны после break.
 */
export interface OrderBlockZone {
  id: SmcZoneId;
  /** 'bull' = поддержка снизу; 'bear' = сопротивление сверху. */
  kind: 'bull' | 'bear';
  /** Время свечи самого OB (левая граница прямоугольника). */
  startTime: TimestampMs;
  /**
   * Правая граница: либо время mitigation-свечи, либо время последней свечи,
   * пока зона ещё «живая».
   */
  endTime: TimestampMs;
  minPrice: Price;
  maxPrice: Price;
  /** Был ли между OB и break-свечой Fair Value Gap — повышает «качество» OB. */
  hasFvg: boolean;
  /** true = ещё не отработан (цена не возвращалась внутрь OB). */
  unmitigated: boolean;
  /** Тип структурного события, породившего этот OB. */
  breakKind: 'BOS' | 'CHoCH';
}
