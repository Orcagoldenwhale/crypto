/**
 * Запуск оптимизации с группировкой комбинаций по SMC-подмножеству.
 *
 * Для каждой уникальной комбинации SMC-параметров overlay пересчитывается
 * ОДИН РАЗ через runSmcAnalysis. Затем все бэктесты с этим overlay'ем
 * прогоняются последовательно (это дёшево — миллисекунды на прогон).
 *
 * Чанкинг: каждые CHUNK_SIZE бэктестов отдаём UI через setTimeout(0).
 * Прогресс обновляется и можно прервать через AbortSignal.
 */

import { runBacktest } from '@/backtest/runBacktest';
import type { BacktestSettings } from '@/backtest/types';
import { runSmcAnalysis } from '@/engine/smc';
import type { SmcLayers, SmcOptions, SmcOverlay } from '@/engine/smc/types';
import type { Candle5m } from '@/types';
import type { Candle1h, Candle15m } from '@/types';
import { computeScore } from './metrics';
import { smcGroupKey, type Combo } from './generateGrid';
import type {
  OptimizerProgress,
  OptimizerResult,
  OptimizerSettings,
} from './types';

const CHUNK_SIZE = 50;

export interface RunOptimizerArgs {
  /** LTF свечи для бэктеста. */
  candles: readonly Candle5m[];
  /** Свечи на которых считается smc-overlay (HTF в multi-режиме, иначе те же). */
  smcCandles: readonly (Candle1h | Candle15m | Candle5m)[];
  /** Стартовый smcOverlay (для случая когда SMC-параметры не варьируются). */
  baseOverlay: SmcOverlay;
  /** Базовые SMC-настройки (на них накладываются варьируемые поля). */
  baseSmcOpts: SmcOptions;
  /** Какие слои SMC активны. */
  smcLayers: SmcLayers;
  /** Базовые настройки бэктеста. */
  baseSettings: BacktestSettings;
  /** Все комбинации. */
  combos: readonly Combo[];
  optSettings: OptimizerSettings;
  signal?: AbortSignal;
  onProgress?: (p: OptimizerProgress) => void;
}

export async function runOptimizer({
  candles,
  smcCandles,
  baseOverlay,
  baseSmcOpts,
  smcLayers,
  baseSettings,
  combos,
  optSettings,
  signal,
  onProgress,
}: RunOptimizerArgs): Promise<OptimizerResult[]> {
  const baseQuiet: BacktestSettings = { ...baseSettings, debugLog: false };
  const top: OptimizerResult[] = [];
  let bestScore: number | null = null;

  // 1. Группируем комбинации по их SMC-подмножеству — для каждой группы
  // overlay будет пересчитан один раз.
  const groups = new Map<string, { smcOpts: SmcOptions; overlay: SmcOverlay | null; items: Combo[] }>();
  for (const c of combos) {
    const key = smcGroupKey(c.smc);
    let g = groups.get(key);
    if (!g) {
      const smcOpts: SmcOptions = { ...baseSmcOpts, ...c.smc };
      g = { smcOpts, overlay: null, items: [] };
      groups.set(key, g);
    }
    g.items.push(c);
  }

  let processed = 0;
  for (const g of groups.values()) {
    if (signal?.aborted) break;

    // Подготовить overlay: если SMC-перебор пустой (g.smcOpts === baseSmcOpts
    // по содержанию), переиспользуем baseOverlay; иначе пересчитываем.
    const isBaseSmc = Object.keys(g.items[0]?.smc ?? {}).length === 0;
    const overlay = isBaseSmc
      ? baseOverlay
      : runSmcAnalysis(smcCandles, smcLayers, g.smcOpts);
    g.overlay = overlay;
    // Дать UI отрисоваться сразу после тяжёлого runSmcAnalysis.
    await new Promise((r) => setTimeout(r, 0));

    for (const c of g.items) {
      if (signal?.aborted) break;
      const merged: BacktestSettings = {
        ...baseQuiet,
        ...c.bt,
        // fvgMaxFillPct в BacktestSettings прокидывается из SmcOptions
        // (см. App.tsx handleRunBacktest). Если оптимизируем его — берём
        // из smc-перебора, иначе из base.
        fvgMaxFillPct: c.smc.fvgMaxFillPct ?? g.smcOpts.fvgMaxFillPct,
      };
      const report = runBacktest(candles, overlay, merged);
      const score = computeScore(report, optSettings.metric);

      if (Number.isFinite(score)) {
        insertSorted(top, { btParams: c.bt, smcParams: c.smc, report, score }, optSettings.topN);
        if (bestScore === null || score > bestScore) bestScore = score;
      }

      processed++;
      if (processed % CHUNK_SIZE === 0) {
        onProgress?.({ done: processed, total: combos.length, bestScore });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  onProgress?.({ done: processed, total: combos.length, bestScore });
  return top;
}

function insertSorted(top: OptimizerResult[], item: OptimizerResult, topN: number): void {
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
