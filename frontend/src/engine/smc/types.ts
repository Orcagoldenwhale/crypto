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
  /** 'high' (equal highs = BSL, бычья ловушка) | 'low' (equal lows = SSL). */
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
  /**
   * Расположение уровня относительно последнего структурного диапазона:
   * - 'external': уровень ВЫШЕ последнего swing high (для high)
   *               или НИЖЕ последнего swing low (для low).
   *               Главные цели крупных участников.
   * - 'internal': уровень внутри последнего range — промежуточная
   *               ликвидность, чаще снимается по пути.
   * - 'unknown': не удалось классифицировать (нет структуры).
   */
  position: 'internal' | 'external' | 'unknown';
}

/**
 * PDH/PDL — максимум/минимум предыдущего дня.
 *
 * Классическая концепция ликвидности из лекции: интрадей-цели для цены.
 * После пересечения уровень "теряет актуальность" — помечаем как mitigated.
 */
export interface PrevDayLevelZone {
  id: SmcZoneId;
  /** 'high' = PDH (BSL); 'low' = PDL (SSL). */
  kind: 'high' | 'low';
  /** Цена уровня. */
  price: Price;
  /** Начало действия — 00:00 UTC дня после периода-источника. */
  startTime: TimestampMs;
  /** Конец действия — либо время пересечения, либо последняя свеча. */
  endTime: TimestampMs;
  /** Дата периода-источника (ISO, YYYY-MM-DD). */
  sourceDate: string;
  /** true — цена ещё не пересекала уровень. */
  unmitigated: boolean;
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
  breakerBlocks: boolean;
  rejectionBlocks: boolean;
}

/** Способ выделения границ OB. */
export type ObExtractionMode = 'wicks' | 'body' | 'auto';

export interface SmcOptions {
  lookback: number;
  equalityTolerancePct: number;
  hideMitigated: SmcHideMitigated;
  /** FVG считается валидным, пока не перекрыт более чем на X% (0–100). */
  fvgMaxFillPct: number;
  /** Мин. размер FVG в % от цены. FVG меньше порога не отображаются. */
  minFvgPct: number;
  /**
   * Как выделять границы OB:
   * - 'wicks' — по фитилям (low/high свечи). Классика для крипты.
   * - 'body'  — по телу (min/max от open/close). Для широких тел.
   * - 'auto'  — по фитилям если фитили большие, иначе по телу.
   */
  obExtraction: ObExtractionMode;
  /**
   * Учитывать Mean Threshold (50% тела OB).
   * Если включено — OB считается mitigated только при закрытии тела свечи
   * за уровень MT, а не при касании границы. Касание фитилем не считается.
   */
  obUseMeanThreshold: boolean;
  /**
   * Требовать "поглощение" следующих свеч телом за пределами тела OB.
   * Если включено — отбрасываем OB, у которых impulse-свечи закрылись
   * внутри тела блока (слабое поглощение).
   */
  obRequireAbsorption: boolean;
  /**
   * Минимальное соотношение фитиль/тело для Rejection Block.
   * Свеча считается RB только если её фитиль >= rbWickRatio * тело.
   */
  rbWickRatio: number;
  /**
   * Требовать ли для RB снятие ликвидности (sweep swing high/low).
   * Если true — RB-фитиль должен пробивать swing-точку, обнаруженную
   * детектором ликвидности.
   */
  rbRequireSweep: boolean;

  // ============== Liquidity =================
  /** Показывать EQH/EQL расположенные снаружи последнего range (external). */
  liqShowExternal: boolean;
  /** Показывать EQH/EQL внутри последнего range (internal). */
  liqShowInternal: boolean;
  /** Подписывать уровни как BSL/SSL вместо EQH/EQL. */
  liqUseBslSslLabels: boolean;
  /** Включить отдельный слой Previous Day High/Low. */
  liqShowPrevDay: boolean;
}

/** Видимость каждого слоя (тогглы из Toolbox). */
export interface SmcLayers {
  fvg: boolean;
  liquidity: boolean;
  structure: boolean;
  orderBlocks: boolean;
  breakerBlocks: boolean;
  rejectionBlocks: boolean;
}

/** Результат расчёта — ровно то, что отрендерится поверх свечей. */
export interface SmcOverlay {
  fvgs: readonly FvgZone[];
  liquidity: readonly LiquidityZone[];
  structure: readonly StructureBreak[];
  orderBlocks: readonly OrderBlockZone[];
  breakerBlocks: readonly BreakerBlockZone[];
  rejectionBlocks: readonly RejectionBlockZone[];
  prevDayLevels: readonly PrevDayLevelZone[];
}

export const EMPTY_SMC_OVERLAY: SmcOverlay = Object.freeze({
  fvgs: [],
  liquidity: [],
  structure: [],
  orderBlocks: [],
  breakerBlocks: [],
  rejectionBlocks: [],
  prevDayLevels: [],
});

export const DEFAULT_HIDE_MITIGATED: SmcHideMitigated = Object.freeze({
  fvg: false,
  liquidity: false,
  structure: false,
  orderBlocks: false,
  breakerBlocks: false,
  rejectionBlocks: false,
});

export const DEFAULT_SMC_OPTIONS: SmcOptions = Object.freeze({
  lookback: 5,
  equalityTolerancePct: 0.0005,
  hideMitigated: DEFAULT_HIDE_MITIGATED,
  minFvgPct: 0.1,
  fvgMaxFillPct: 50,
  obExtraction: 'wicks',
  obUseMeanThreshold: false,
  obRequireAbsorption: false,
  rbWickRatio: 2,
  rbRequireSweep: true,
  liqShowExternal: true,
  liqShowInternal: true,
  liqUseBslSslLabels: false,
  liqShowPrevDay: false,
});

export const DEFAULT_SMC_LAYERS: SmcLayers = Object.freeze({
  fvg: true,
  liquidity: true,
  structure: true,
  orderBlocks: true,
  breakerBlocks: false,
  rejectionBlocks: false,
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
  /** Время OB-свечи — для визуальной левой границы прямоугольника. */
  obTime: TimestampMs;
  /** Время break-свечи (BOS/CHoCH) — зона активна только после этого момента. */
  startTime: TimestampMs;
  /**
   * Правая граница: либо время mitigation-свечи, либо время последней свечи,
   * пока зона ещё «живая».
   */
  endTime: TimestampMs;
  minPrice: Price;
  maxPrice: Price;
  /** Mean Threshold — 50% от тела OB-свечи (между open и close). */
  mtPrice: Price;
  /** Был ли между OB и break-свечой Fair Value Gap — повышает «качество» OB. */
  hasFvg: boolean;
  /** true = ещё не отработан (цена не возвращалась внутрь OB). */
  unmitigated: boolean;
  /** Тип структурного события, породившего этот OB. */
  breakKind: 'BOS' | 'CHoCH';
}

/**
 * Breaker Block (BB) — пробитый и развернувшийся ордерблок.
 *
 * Логика: bull-OB сработал → цена развернулась → пробила нижнюю границу OB
 * → произошёл BOS↓ → теперь этот блок становится bear-BB (сопротивление).
 * Аналогично bear-OB → bull-BB (поддержка) после пробоя вверх.
 *
 * Зона совпадает с границами оригинального OB, но `kind` инвертируется:
 * блок теперь работает в противоположную сторону.
 */
export interface BreakerBlockZone {
  id: SmcZoneId;
  /** Направление BB после переворота. */
  kind: 'bull' | 'bear';
  /** Время свечи, на которой произошёл пробой OB → break (start активности). */
  startTime: TimestampMs;
  /** Время mitigation BB либо последняя свеча. */
  endTime: TimestampMs;
  /** Время оригинальной OB-свечи — визуальная левая граница. */
  obTime: TimestampMs;
  minPrice: Price;
  maxPrice: Price;
  /** Mean Threshold — 50% тела оригинальной OB-свечи. */
  mtPrice: Price;
  /** true = ещё не отработан (цена не возвращалась к BB). */
  unmitigated: boolean;
  /** ID исходного OB, из которого получился этот BB. */
  sourceObId: SmcZoneId;
}

/**
 * Rejection Block (RB) — свеча с длинным фитилём, снимающим ликвидность.
 *
 * Зона = САМ ФИТИЛЬ (не вся свеча):
 *   bull RB: фитиль снизу → зона [low, min(open, close)]
 *   bear RB: фитиль сверху → зона [max(open, close), high]
 *
 * Критерии:
 *   - длина фитиля ≥ rbWickRatio × тело свечи;
 *   - фитиль пробивает swing-точку (sweep ликвидности) — если включено.
 */
export interface RejectionBlockZone {
  id: SmcZoneId;
  /** 'bull' = поддержка снизу; 'bear' = сопротивление сверху. */
  kind: 'bull' | 'bear';
  /** Время RB-свечи (визуальная левая граница). */
  obTime: TimestampMs;
  /** Зона активна после закрытия RB-свечи. */
  startTime: TimestampMs;
  /** Правая граница: mitigation либо последняя свеча. */
  endTime: TimestampMs;
  /** Нижняя граница фитиля. */
  minPrice: Price;
  /** Верхняя граница фитиля. */
  maxPrice: Price;
  /** Mean Threshold — 50% фитиля. */
  mtPrice: Price;
  /** Был ли подтверждённый sweep ликвидности (если детектировался). */
  hasSweep: boolean;
  /** true = ещё не отработан (цена не возвращалась внутрь фитиля). */
  unmitigated: boolean;
}
