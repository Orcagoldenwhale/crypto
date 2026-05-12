/**
 * Генерация комбинаций параметров для грид-поиска.
 *
 * Берёт OptimizerSpecs, для каждого enabled-параметра разворачивает в
 * массив значений, потом считает декартово произведение и возвращает
 * массив комбинаций. Каждая комбинация — это пара {bt, smc}: значения
 * полей BacktestSettings и SmcOptions, которые надо подставить.
 */

import type { BacktestSettings } from '@/backtest/types';
import type { SmcOptions } from '@/engine/smc/types';
import {
  isDataKey,
  isSmcKey,
  type OptimizableKey,
  type OptimizerSpecs,
  type ParamSpec,
} from './types';

export interface ComboData {
  /** Перегруппировка свеч (×1 / ×2 / ×5 / ×10). undefined = текущее. */
  tickMultiplier?: number;
}

export interface Combo {
  bt: Partial<BacktestSettings>;
  smc: Partial<SmcOptions>;
  data: ComboData;
}

/** Список значений для одного включённого параметра. */
function expandSpec(spec: ParamSpec): unknown[] {
  if (!spec.enabled) return [];
  if (spec.type === 'number') {
    const out: number[] = [];
    const steps = Math.floor((spec.to - spec.from) / spec.step + 1e-9) + 1;
    for (let i = 0; i < steps; i++) {
      const v = spec.from + i * spec.step;
      out.push(round6(v));
    }
    return out;
  }
  if (spec.type === 'bool') {
    return spec.bothValues ? [false, true] : [];
  }
  return [...spec.values];
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Сколько комбинаций даст текущая конфигурация (без генерации). */
export function countCombinations(specs: OptimizerSpecs): number {
  let total = 1;
  let anyEnabled = false;
  for (const key of Object.keys(specs) as OptimizableKey[]) {
    const arr = expandSpec(specs[key]);
    if (arr.length === 0) continue;
    anyEnabled = true;
    total *= arr.length;
    if (total > 1e9) return Number.POSITIVE_INFINITY;
  }
  return anyEnabled ? total : 0;
}

/**
 * Декартово произведение всех включённых параметров. Возвращает
 * массив комбинаций — каждая разнесена по двум объектам {bt, smc}.
 */
export function generateGrid(specs: OptimizerSpecs): Combo[] {
  const entries: { key: OptimizableKey; values: unknown[] }[] = [];
  for (const key of Object.keys(specs) as OptimizableKey[]) {
    const arr = expandSpec(specs[key]);
    if (arr.length > 0) entries.push({ key, values: arr });
  }
  if (entries.length === 0) return [];

  let acc: Combo[] = [{ bt: {}, smc: {}, data: {} }];
  for (const { key, values } of entries) {
    const next: Combo[] = [];
    for (const base of acc) {
      for (const v of values) {
        if (isDataKey(key)) {
          // tickMultiplier enum хранит строки '1'/'2'/..., приводим к number.
          const num = typeof v === 'string' ? Number(v) : (v as number);
          next.push({ bt: base.bt, smc: base.smc, data: { ...base.data, [key]: num } });
        } else if (isSmcKey(key)) {
          next.push({ bt: base.bt, smc: { ...base.smc, [key]: v }, data: base.data });
        } else {
          next.push({ bt: { ...base.bt, [key]: v }, smc: base.smc, data: base.data });
        }
      }
    }
    acc = next;
  }
  return acc;
}

/**
 * Стабильный ключ для группировки комбинаций по их SMC-подмножеству.
 * Все комбинации с одинаковым ключом могут переиспользовать один overlay.
 */
export function smcGroupKey(smc: Partial<SmcOptions>): string {
  const keys = Object.keys(smc).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${k}=${JSON.stringify((smc as Record<string, unknown>)[k])}`);
  }
  return parts.join('|');
}

export function dataGroupKey(data: ComboData): string {
  return data.tickMultiplier === undefined ? '' : `mult=${data.tickMultiplier}`;
}
