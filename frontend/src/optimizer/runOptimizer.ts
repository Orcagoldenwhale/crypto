/**
 * Запуск оптимизации с двухуровневой группировкой:
 *   1) внешняя — по `tickMultiplier` (тяжёлая перегруппировка свеч);
 *   2) внутренняя — по SMC-подмножеству (пересчёт overlay).
 *
 * Для каждой пары (mult, smc-subset) тяжёлые операции выполняются ОДИН раз,
 * все бэктесты этой группы переиспользуют результат. Чанкинг + AbortSignal
 * сохранены.
 */

import { runBacktest } from '@/backtest/runBacktest';
import type { BacktestSettings } from '@/backtest/types';
import { runSmcAnalysis } from '@/engine/smc';
import type { SmcLayers, SmcOptions, SmcOverlay } from '@/engine/smc/types';
import type { Candle1h, Candle15m, Candle5m } from '@/types';
import { computeScore } from './metrics';
import { dataGroupKey, smcGroupKey, type Combo } from './generateGrid';
import type {
  OptimizerProgress,
  OptimizerResult,
  OptimizerSettings,
} from './types';

const CHUNK_SIZE = 50;

/** Что callback возвращает для конкретного значения tickMultiplier. */
export interface PreparedData {
  candles: readonly Candle5m[];
  smcCandles: readonly (Candle1h | Candle15m | Candle5m)[];
}

export interface RunOptimizerArgs {
  /**
   * Получить набор свеч для заданного множителя. Если множитель не
   * задан в комбинации — вызывается с undefined, возвращает текущее.
   */
  prepareData: (mult: number | undefined) => PreparedData;
  baseSmcOpts: SmcOptions;
  smcLayers: SmcLayers;
  baseSettings: BacktestSettings;
  combos: readonly Combo[];
  optSettings: OptimizerSettings;
  signal?: AbortSignal;
  onProgress?: (p: OptimizerProgress) => void;
}

export async function runOptimizer({
  prepareData,
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

  // 1. Двухуровневая группировка: data → smc → comboList.
  const dataGroups = new Map<string, { mult: number | undefined; smcGroups: Map<string, { smcOpts: SmcOptions; items: Combo[] }> }>();
  for (const c of combos) {
    const dKey = dataGroupKey(c.data);
    let dGroup = dataGroups.get(dKey);
    if (!dGroup) {
      dGroup = { mult: c.data.tickMultiplier, smcGroups: new Map() };
      dataGroups.set(dKey, dGroup);
    }
    const sKey = smcGroupKey(c.smc);
    let sGroup = dGroup.smcGroups.get(sKey);
    if (!sGroup) {
      const smcOpts: SmcOptions = { ...baseSmcOpts, ...c.smc };
      sGroup = { smcOpts, items: [] };
      dGroup.smcGroups.set(sKey, sGroup);
    }
    sGroup.items.push(c);
  }

  let processed = 0;
  for (const dGroup of dataGroups.values()) {
    if (signal?.aborted) break;
    const { candles, smcCandles } = prepareData(dGroup.mult);
    // Дать UI отрисоваться после перегруппировки.
    await new Promise((r) => setTimeout(r, 0));

    for (const sGroup of dGroup.smcGroups.values()) {
      if (signal?.aborted) break;
      const overlay: SmcOverlay = runSmcAnalysis(smcCandles, smcLayers, sGroup.smcOpts);
      await new Promise((r) => setTimeout(r, 0));

      for (const c of sGroup.items) {
        if (signal?.aborted) break;
        const merged: BacktestSettings = {
          ...baseQuiet,
          ...c.bt,
          fvgMaxFillPct: c.smc.fvgMaxFillPct ?? sGroup.smcOpts.fvgMaxFillPct,
        };
        const report = runBacktest(candles, overlay, merged);
        const score = computeScore(report, optSettings.metric);

        if (Number.isFinite(score)) {
          insertSorted(
            top,
            {
              btParams: c.bt,
              smcParams: c.smc,
              dataParams: c.data,
              report,
              score,
            },
            optSettings.topN,
          );
          if (bestScore === null || score > bestScore) bestScore = score;
        }

        processed++;
        if (processed % CHUNK_SIZE === 0) {
          onProgress?.({ done: processed, total: combos.length, bestScore });
          await new Promise((r) => setTimeout(r, 0));
        }
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
