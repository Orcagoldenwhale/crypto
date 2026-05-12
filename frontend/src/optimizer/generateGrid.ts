/**
 * Генерация комбинаций параметров для грид-поиска.
 *
 * Берёт OptimizerSpecs, для каждого enabled-параметра разворачивает в
 * массив значений, потом считает декартово произведение и возвращает
 * массив комбинаций — каждая комбинация это Partial<BacktestSettings>.
 */

import type { BacktestSettings } from '@/backtest/types';
import type { OptimizableKey, OptimizerSpecs, ParamSpec } from './types';

/** Список значений для одного включённого параметра. */
function expandSpec(spec: ParamSpec): unknown[] {
  if (!spec.enabled) return [];
  if (spec.type === 'number') {
    const out: number[] = [];
    // step может быть дробным — копим через округление, чтобы не накапливалась
    // ошибка плавающей точки (0.1 + 0.1 + 0.1 ≠ 0.3).
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
  // enum
  return [...spec.values];
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Сколько комбинаций даст текущая конфигурация (без генерации). */
export function countCombinations(specs: OptimizerSpecs): number {
  let total = 1;
  for (const key of Object.keys(specs) as OptimizableKey[]) {
    const arr = expandSpec(specs[key]);
    if (arr.length === 0) continue;
    total *= arr.length;
    if (total > 1e9) return Number.POSITIVE_INFINITY; // защита от переполнения
  }
  // Если ничего не включено — 0 комбинаций (нечего перебирать).
  for (const key of Object.keys(specs) as OptimizableKey[]) {
    if (specs[key].enabled) return total;
  }
  return 0;
}

/**
 * Декартово произведение всех включённых параметров.
 * Возвращает массив Partial<BacktestSettings> — каждая запись это
 * один набор значений для прогона.
 */
export function generateGrid(specs: OptimizerSpecs): Partial<BacktestSettings>[] {
  const entries: { key: OptimizableKey; values: unknown[] }[] = [];
  for (const key of Object.keys(specs) as OptimizableKey[]) {
    const arr = expandSpec(specs[key]);
    if (arr.length > 0) entries.push({ key, values: arr });
  }
  if (entries.length === 0) return [];

  let acc: Partial<BacktestSettings>[] = [{}];
  for (const { key, values } of entries) {
    const next: Partial<BacktestSettings>[] = [];
    for (const base of acc) {
      for (const v of values) {
        next.push({ ...base, [key]: v });
      }
    }
    acc = next;
  }
  return acc;
}
