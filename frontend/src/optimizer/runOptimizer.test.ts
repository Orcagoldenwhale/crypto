import { describe, it, expect } from 'vitest';
import { runOptimizer, type PreparedData } from './runOptimizer';
import { DEFAULT_OPTIMIZER_SETTINGS } from './types';
import type { Combo } from './generateGrid';
import type { Candle5m } from '@/types';
import type { SmcLayers, SmcOptions } from '@/engine/smc/types';
import { DEFAULT_BACKTEST_SETTINGS } from '@/backtest/types';

function emptyCandles(): readonly Candle5m[] {
  return [];
}

function dummyPrepareData(): PreparedData {
  return { candles: emptyCandles(), smcCandles: emptyCandles() };
}

const layers: SmcLayers = {
  fvg: false,
  liquidity: false,
  structure: false,
  orderBlocks: false,
  breakerBlocks: false,
  rejectionBlocks: false,
};

// Минимальные SMC-опции (не важны для теста — overlay будет пустой
// потому что свечей нет).
const baseSmcOpts = {
  lookback: 5,
  equalityTolerancePct: 0.0005,
  hideMitigated: {
    fvg: false, liquidity: false, structure: false,
    orderBlocks: false, breakerBlocks: false, rejectionBlocks: false,
  },
  fvgMaxFillPct: 50,
  minFvgPct: 0.1,
  obExtraction: 'wicks' as const,
  obUseMeanThreshold: false,
  obMtIncludeWicks: false,
  obRequireAbsorption: false,
  obAllowMultiCandle: false,
  obMultiCandleMax: 3,
  obSearchAtSweep: false,
  obSearchAtFvg: false,
  obSearchAtPrevBlock: false,
  rbWickRatio: 2,
  rbRequireSweep: true,
  rbAlsoAtFvg: false,
  rbAlsoAtPrevBlock: false,
  rbUseMeanThreshold: false,
  rbMtIncludeWicks: false,
  liqShowExternal: true,
  liqShowInternal: true,
  liqUseBslSslLabels: false,
  liqShowPrevDay: false,
  liqShowCompression: false,
  liqCompressionMinPoints: 3,
} as unknown as SmcOptions;

describe('runOptimizer', () => {
  it('startIndex пропускает первые N комбинаций', async () => {
    const combos: Combo[] = Array.from({ length: 5 }, (_, i) => ({
      bt: { stopPct: 0.1 + i * 0.1 },
      smc: {},
      data: {},
    }));
    let count = 0;
    // Подменим prepareData: возвращаем пустые свечи, чтобы runBacktest
    // ничего не считал. Счётчик растёт по вызовам.
    const prepare = (): PreparedData => {
      count++;
      return dummyPrepareData();
    };
    await runOptimizer({
      prepareData: prepare,
      baseSmcOpts,
      smcLayers: layers,
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      combos,
      optSettings: DEFAULT_OPTIMIZER_SETTINGS,
      startIndex: 3,
    });
    // prepareData вызывается лениво на первой комбинации после смены mult.
    // Если starting from index=3 — для 5 комбо отработаны только 4-я и 5-я.
    expect(count).toBe(1); // Tick mult не варьировался → один и тот же ключ.
  });

  it('pauseSignal останавливает прогон и вызывает onPause со снимком', async () => {
    const combos: Combo[] = Array.from({ length: 200 }, (_, i) => ({
      bt: { stopPct: 0.1 + i * 0.01 },
      smc: {},
      data: {},
    }));
    const ac = new AbortController();
    // Поставим паузу сразу же — должно отработать минимум одну итерацию.
    ac.abort();
    let snapshot: { processed: number; top: unknown[] } | null = null;
    await runOptimizer({
      prepareData: dummyPrepareData,
      baseSmcOpts,
      smcLayers: layers,
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      combos,
      optSettings: DEFAULT_OPTIMIZER_SETTINGS,
      pauseSignal: ac.signal,
      onPause: (s) => { snapshot = s; },
    });
    expect(snapshot).not.toBeNull();
    const ss = snapshot as unknown as { processed: number; top: unknown[] };
    // pauseSignal сработал ещё до старта итерации.
    expect(ss.processed).toBe(0);
    expect(Array.isArray(ss.top)).toBe(true);
  });

  it('initialTop сохраняется при resume', async () => {
    const seed = [{
      btParams: {},
      smcParams: {},
      dataParams: {},
      report: {
        totalTrades: 1, wins: 1, losses: 0, openTrades: 0,
        winRate: 1, totalPnlR: 2, avgPnlR: 2, maxConsecutiveLosses: 0,
        trades: [],
      },
      score: 2,
    }] as const;
    const top = await runOptimizer({
      prepareData: dummyPrepareData,
      baseSmcOpts,
      smcLayers: layers,
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      combos: [],
      optSettings: DEFAULT_OPTIMIZER_SETTINGS,
      initialTop: seed,
    });
    expect(top).toHaveLength(1);
    expect(top[0]!.score).toBe(2);
  });
});
