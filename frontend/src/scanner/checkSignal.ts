/**
 * Реализация 4-правильного скрининга свечей на LONG/SHORT-сигналы.
 *
 * Источник правил — спецификация в docs/01-spec.md (раздел "Алгоритм сканера")
 * и референс-прототип docs/prototype-reference.jsx (строки 140-141).
 *
 * Правила LONG (все 4 должны быть true):
 *   R1. Поляризация:  close > (high + low) / 2  — закрытие в верхней половине свечи
 *   R2. Total delta:  delta > 0                 — общий объём покупок > продаж
 *   R3. Close vs VPOC: close > vpoc_price       — цена закрылась выше точки максимального объёма
 *   R4. Поглощение на low:  delta_at_low < 0    — на минимуме свечи был агрессивный sell, который купили
 *
 * Правила SHORT — зеркальные:
 *   R1. close < (high + low) / 2
 *   R2. delta < 0
 *   R3. close < vpoc_price
 *   R4. delta_at_high > 0
 *
 * ВАЖНО: функция чистая, без побочных эффектов и зависимостей от React.
 *        Это позволяет использовать её в Web Worker и легко тестировать.
 */

import type { Candle5m, Cluster, Price, SignalDiagnostics, SignalType } from '@/types';

/** Множитель имбаланса (синхронизирован с footprint-рендером). */
const IMBALANCE_RATIO = 2;

// ============================================================================
// Типы результата
// ============================================================================

export type RuleId = 'polarity' | 'totalDelta' | 'closeVsVpoc' | 'absorption';

/** Полная диагностика 4 правил для одной свечи. */
export interface SignalCheck {
  /** LONG / SHORT / null если ни одно направление не закрыло все 4 правила. */
  type: SignalType | null;
  /** Какие правила прошли по LONG-критерию (true=прошло). */
  longRules: Record<RuleId, boolean>;
  /** Какие правила прошли по SHORT-критерию. */
  shortRules: Record<RuleId, boolean>;
}

// ============================================================================
// Главная функция
// ============================================================================

export function checkSignal(candle: Candle5m): SignalCheck {
  const mid = (candle.high + candle.low) / 2;

  // LONG-критерии
  const longRules: Record<RuleId, boolean> = {
    polarity: candle.close > mid,
    totalDelta: candle.delta > 0,
    closeVsVpoc: candle.close > candle.vpoc_price,
    absorption: candle.delta_at_low < 0,
  };

  // SHORT-критерии (зеркальные)
  const shortRules: Record<RuleId, boolean> = {
    polarity: candle.close < mid,
    totalDelta: candle.delta < 0,
    closeVsVpoc: candle.close < candle.vpoc_price,
    absorption: candle.delta_at_high > 0,
  };

  const allLong = longRules.polarity && longRules.totalDelta && longRules.closeVsVpoc && longRules.absorption;
  const allShort = shortRules.polarity && shortRules.totalDelta && shortRules.closeVsVpoc && shortRules.absorption;

  // Теоретически allLong и allShort не могут быть оба true одновременно
  // (правила R1/R2 строго противоположны), но на всякий случай отдадим приоритет LONG.
  const type: SignalType | null = allLong ? 'LONG' : allShort ? 'SHORT' : null;

  return { type, longRules, shortRules };
}

// ============================================================================
// Сборка численной диагностики для UI
// ============================================================================

/**
 * Возвращает реальные численные метрики 4 правил + два бонус-индикатора.
 *
 * Используется при создании Signal, чтобы детальная карточка сделки могла
 * показать «закрытие 65 432 vs середина 65 401», а не просто галочку.
 *
 * Поля высчитываются ИДЕНТИЧНО проверкам в `checkSignal()` —
 * любое расхождение здесь ломает доверие к UI.
 *
 * @param candle Свеча для анализа.
 * @param type   Направление сигнала. От него зависит, какого цвета имбалансы
 *               считаем (бычьи для LONG, медвежьи для SHORT) и какой экстремум
 *               проверяем на «нуль».
 */
export function buildDiagnostics(candle: Candle5m, type: SignalType): SignalDiagnostics {
  const vpoc = candle.vpoc_price;

  // Объёмы на уровнях экстремумов нужно достать из массива clusters,
  // т.к. в Candle5m хранятся только delta_at_low/high, но не vol_at_low/high.
  // Это лёгкая операция, и нужно только для уже-найденных сигналов (≪ всех свечей).
  let volAtLow = 0;
  let volAtHigh = 0;
  if (candle.clusters.length > 0) {
    let bestLow = candle.clusters[0]!;
    let bestHigh = candle.clusters[0]!;
    for (const c of candle.clusters) {
      if (Math.abs(c.price - candle.low) < Math.abs(bestLow.price - candle.low)) bestLow = c;
      if (Math.abs(c.price - candle.high) < Math.abs(bestHigh.price - candle.high)) bestHigh = c;
    }
    volAtLow = bestLow.vol;
    volAtHigh = bestHigh.vol;
  }

  const { count: imbalanceCount, prices: imbalancePrices } = countImbalances(
    candle.clusters,
    type,
  );
  const hasZeroAtExtreme = detectZeroAtExtreme(candle.clusters, type);

  return {
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    mid: (candle.high + candle.low) / 2,
    totalDelta: candle.delta,
    vpoc_price: vpoc,
    delta_at_low: candle.delta_at_low,
    delta_at_high: candle.delta_at_high,
    vol_at_low: volAtLow,
    vol_at_high: volAtHigh,
    imbalanceCount,
    imbalancePrices,
    hasZeroAtExtreme,
  };
}

// ============================================================================
// Бонус-индикаторы (необязательные условия — для подсказки трейдеру)
// ============================================================================

/**
 * Считает количество одноцветных имбалансов в свече.
 *
 * Бычий (зелёный) имбаланс: `ask ≥ 2 × bid` И `bid > 0` (если bid=0 — это «нуль»,
 * см. detectZeroAtExtreme; имбалансом не считаем, чтобы не дублировать сигнал).
 *
 * Медвежий (красный): `bid ≥ 2 × ask` И `ask > 0`.
 *
 * Для LONG считаем бычьи (поток покупок ↑), для SHORT — медвежьи (поток продаж ↓).
 *
 * Также возвращает цены ячеек, на которых имбаланс сработал — для подсветки в UI.
 */
export function countImbalances(
  clusters: readonly Cluster[],
  type: SignalType,
): { count: number; prices: Price[] } {
  const prices: Price[] = [];
  for (const cl of clusters) {
    if (type === 'LONG') {
      if (cl.bid > 0 && cl.ask >= cl.bid * IMBALANCE_RATIO) prices.push(cl.price);
    } else {
      if (cl.ask > 0 && cl.bid >= cl.ask * IMBALANCE_RATIO) prices.push(cl.price);
    }
  }
  return { count: prices.length, prices };
}

/**
 * Проверяет, есть ли «нуль на экстремуме» свечи (исчерпание аукциона).
 *
 * - LONG  → на самом нижнем кластере `ask == 0` (на лоу нет агрессивных покупок).
 * - SHORT → на самом верхнем кластере `bid == 0` (на хае нет агрессивных продаж).
 *
 * Кластеры считаются отсортированными по price ↑ (см. инвариант Candle5m).
 */
export function detectZeroAtExtreme(
  clusters: readonly Cluster[],
  type: SignalType,
): boolean {
  if (clusters.length === 0) return false;
  if (type === 'LONG') {
    return clusters[0]!.ask === 0;
  }
  return clusters[clusters.length - 1]!.bid === 0;
}

// ============================================================================
// Утилита: проверка попадания свечи в зону
// ============================================================================

interface MinimalZone {
  startTime: number;
  endTime: number;
  minPrice: number;
  maxPrice: number;
}

/**
 * Свеча считается попадающей в зону, если:
 *   1) её timestamp лежит в [startTime, endTime]
 *   2) её ценовой интервал [low, high] пересекается с [minPrice, maxPrice]
 *
 * Это соответствует подходу прототипа (`docs/prototype-reference.jsx`).
 */
export function candleInZone(candle: Candle5m, zone: MinimalZone): boolean {
  if (candle.timestamp < zone.startTime || candle.timestamp > zone.endTime) return false;
  if (candle.high < zone.minPrice || candle.low > zone.maxPrice) return false;
  return true;
}
