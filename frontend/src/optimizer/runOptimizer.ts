/**
 * Оптимизатор: линейный обход всех комбинаций.
 *
 * Комбинации сортируются по (tickMultiplier, smcGroupKey) и обрабатываются
 * последовательно. Кэш текущего множителя и SMC-ключа избегает повторных
 * `prepareData` / `runSmcAnalysis` — пересчёт только когда соответствующий
 * ключ поменялся.
 *
 * Поддерживает:
 *   - `startIndex` — начать с N-го элемента (для resume).
 *   - `initialTop` — продолжить накапливать результаты в готовый топ.
 *   - `pauseSignal` — мягкая пауза: возвращаемся с накопленным состоянием
 *     через onPause без потери прогресса.
 *   - `signal` — жёсткая отмена (full abort).
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

export interface PreparedData {
  candles: readonly Candle5m[];
  smcCandles: readonly (Candle1h | Candle15m | Candle5m)[];
}

export interface PauseSnapshot {
  /** Сколько комбинаций отработано до паузы. */
  processed: number;
  /** Накопленный топ-N. */
  top: OptimizerResult[];
  /** Что осталось — для возобновления. */
  remaining: Combo[];
}

export interface RunOptimizerArgs {
  prepareData: (mult: number | undefined) => PreparedData;
  baseSmcOpts: SmcOptions;
  smcLayers: SmcLayers;
  baseSettings: BacktestSettings;
  /** Полный список комбинаций (отсортированный или нет — функция сама сортирует). */
  combos: readonly Combo[];
  optSettings: OptimizerSettings;
  /** С какого индекса начать (для resume). По умолчанию 0. */
  startIndex?: number;
  /** Стартовый топ — для resume. По умолчанию []. */
  initialTop?: readonly OptimizerResult[];
  signal?: AbortSignal;
  /** Мягкая пауза. При сработке возвращаемся с состоянием через onPause. */
  pauseSignal?: AbortSignal;
  onProgress?: (p: OptimizerProgress) => void;
  onPause?: (snapshot: PauseSnapshot) => void;
}

export async function runOptimizer({
  prepareData,
  baseSmcOpts,
  smcLayers,
  baseSettings,
  combos,
  optSettings,
  startIndex = 0,
  initialTop,
  signal,
  pauseSignal,
  onProgress,
  onPause,
}: RunOptimizerArgs): Promise<OptimizerResult[]> {
  const baseQuiet: BacktestSettings = { ...baseSettings, debugLog: false };
  const top: OptimizerResult[] = initialTop ? [...initialTop] : [];
  let bestScore: number | null = top.length > 0 ? top[0]!.score : null;

  // 1. Сортируем комбинации в стабильном порядке (data, smc).
  // Это нужно, чтобы кэш currentMult/currentSmcKey хорошо работал
  // (соседние комбинации делят один overlay).
  const ordered = [...combos].sort((a, b) => {
    const ka = dataGroupKey(a.data) + '|' + smcGroupKey(a.smc);
    const kb = dataGroupKey(b.data) + '|' + smcGroupKey(b.smc);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // 2. Кэш текущего пайплайна.
  let currentMultKey: string | null = null;
  let candles: readonly Candle5m[] | null = null;
  let smcCandles: readonly (Candle1h | Candle15m | Candle5m)[] | null = null;
  let currentSmcKey: string | null = null;
  let currentSmcOpts: SmcOptions | null = null;
  let overlay: SmcOverlay | null = null;

  for (let i = startIndex; i < ordered.length; i++) {
    if (signal?.aborted) break;
    if (pauseSignal?.aborted) {
      onPause?.({ processed: i, top, remaining: ordered.slice(i) });
      return top;
    }

    const c = ordered[i]!;

    // 2.1 — данные (tickMultiplier) при необходимости.
    const multKey = dataGroupKey(c.data);
    if (multKey !== currentMultKey) {
      const data = prepareData(c.data.tickMultiplier);
      candles = data.candles;
      smcCandles = data.smcCandles;
      currentMultKey = multKey;
      // Сбрасываем кэш overlay — он зависит от smcCandles.
      currentSmcKey = null;
      overlay = null;
      await new Promise((r) => setTimeout(r, 0));
    }

    // 2.2 — overlay (SMC) при необходимости.
    const smcKey = smcGroupKey(c.smc);
    if (smcKey !== currentSmcKey) {
      currentSmcOpts = { ...baseSmcOpts, ...c.smc };
      overlay = runSmcAnalysis(smcCandles!, smcLayers, currentSmcOpts);
      currentSmcKey = smcKey;
      await new Promise((r) => setTimeout(r, 0));
    }

    // 2.3 — бэктест.
    const merged: BacktestSettings = {
      ...baseQuiet,
      ...c.bt,
      fvgMaxFillPct: c.smc.fvgMaxFillPct ?? currentSmcOpts!.fvgMaxFillPct,
    };
    const report = runBacktest(candles!, overlay!, merged);
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

    const processedSoFar = i + 1;
    if (processedSoFar % CHUNK_SIZE === 0) {
      onProgress?.({ done: processedSoFar, total: ordered.length, bestScore });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ done: ordered.length, total: ordered.length, bestScore });
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
