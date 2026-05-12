/**
 * Запуск оптимизации: пробегается по всем комбинациям параметров,
 * для каждой зовёт runBacktest, считает score и накапливает топ-N.
 *
 * Чанкинг: каждые CHUNK_SIZE комбинаций отдаём управление через
 * `await new Promise(r => setTimeout(r, 0))` — UI продолжает откликаться,
 * прогресс-бар обновляется. Поддерживается отмена через AbortSignal.
 */

import { runBacktest } from '@/backtest/runBacktest';
import type { BacktestSettings } from '@/backtest/types';
import type { Candle5m } from '@/types';
import type { SmcOverlay } from '@/engine/smc/types';
import { computeScore } from './metrics';
import type { OptimizerProgress, OptimizerResult, OptimizerSettings } from './types';

const CHUNK_SIZE = 50;

export interface RunOptimizerArgs {
  candles: readonly Candle5m[];
  overlay: SmcOverlay;
  baseSettings: BacktestSettings;
  combos: readonly Partial<BacktestSettings>[];
  optSettings: OptimizerSettings;
  signal?: AbortSignal;
  onProgress?: (p: OptimizerProgress) => void;
}

export async function runOptimizer({
  candles,
  overlay,
  baseSettings,
  combos,
  optSettings,
  signal,
  onProgress,
}: RunOptimizerArgs): Promise<OptimizerResult[]> {
  // Глобально отключаем дебаг-лог на время оптимизации — он бы писал
  // десятки тысяч строк в backtest-log.txt.
  const baseQuiet: BacktestSettings = { ...baseSettings, debugLog: false };

  const top: OptimizerResult[] = [];
  let bestScore: number | null = null;

  for (let i = 0; i < combos.length; i++) {
    if (signal?.aborted) break;

    const params = combos[i]!;
    const merged: BacktestSettings = { ...baseQuiet, ...params };
    const report = runBacktest(candles, overlay, merged);
    const score = computeScore(report, optSettings.metric);

    if (Number.isFinite(score)) {
      insertSorted(top, { params, report, score }, optSettings.topN);
      if (bestScore === null || score > bestScore) bestScore = score;
    }

    if ((i + 1) % CHUNK_SIZE === 0) {
      onProgress?.({ done: i + 1, total: combos.length, bestScore });
      // Yield to UI thread.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ done: combos.length, total: combos.length, bestScore });
  return top;
}

/**
 * Вставка в сортированный массив по убыванию score, обрезает до topN.
 * Эффективнее чем sort() после каждой вставки — O(topN) на вставку.
 */
function insertSorted(top: OptimizerResult[], item: OptimizerResult, topN: number): void {
  // Найти позицию вставки.
  let lo = 0;
  let hi = top.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (top[mid]!.score >= item.score) lo = mid + 1;
    else hi = mid;
  }
  top.splice(lo, 0, item);
  if (top.length > topN) top.length = topN;
}
