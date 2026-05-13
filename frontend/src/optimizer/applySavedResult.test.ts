import { describe, it, expect, vi } from 'vitest';
import { applySavedResult } from './applySavedResult';
import type { SavedResult } from './savedResults';
import { DEFAULT_BACKTEST_SETTINGS } from '@/backtest/types';
import type { SmcOptions } from '@/engine/smc/types';
import type { TfPairId } from '@/types';

const baseSmcOpts: SmcOptions = {
  lookback: 5,
  equalityTolerancePct: 0.0005,
  hideMitigated: {
    fvg: false, liquidity: false, structure: false,
    orderBlocks: false, breakerBlocks: false, rejectionBlocks: false,
  },
  fvgMaxFillPct: 50,
  minFvgPct: 0.1,
  obExtraction: 'wicks',
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

function makeSaved(overrides: Partial<SavedResult> = {}): SavedResult {
  return {
    id: 'test-id',
    savedAt: Date.now(),
    metric: 'composite',
    score: 1,
    btParams: { stopPct: 0.5 },
    smcParams: { lookback: 7 },
    dataParams: { tickMultiplier: 2 },
    summary: {
      totalTrades: 1, wins: 1, losses: 0, openTrades: 0,
      winRate: 1, totalPnlR: 1, avgPnlR: 1, maxConsecutiveLosses: 0,
    },
    ...overrides,
  };
}

describe('applySavedResult', () => {
  it('применяет BT/SMC/tickMultiplier параметры', () => {
    const onApply = vi.fn();
    const onApplySmc = vi.fn();
    const onApplyMultiplier = vi.fn();
    applySavedResult(makeSaved(), {
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      baseSmcOpts,
      currentTfPairId: '15m-5m',
      onApply,
      onApplySmc,
      onApplyMultiplier,
    });
    expect(onApplySmc).toHaveBeenCalledWith(expect.objectContaining({ lookback: 7 }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ stopPct: 0.5 }));
    expect(onApplyMultiplier).toHaveBeenCalledWith(2);
  });

  it('TF-пара применяется ПЕРВОЙ если она отличается от текущей', () => {
    const calls: string[] = [];
    const onApplyTfPair = vi.fn(() => calls.push('tfPair'));
    const onApplySmc = vi.fn(() => calls.push('smc'));
    const onApply = vi.fn(() => calls.push('bt'));
    applySavedResult(makeSaved({ tfPairId: '5m-5m' }), {
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      baseSmcOpts,
      currentTfPairId: '15m-5m',
      onApply,
      onApplySmc,
      onApplyTfPair,
    });
    expect(onApplyTfPair).toHaveBeenCalledWith('5m-5m');
    // Порядок критичен — TF до BT/SMC.
    expect(calls).toEqual(['tfPair', 'smc', 'bt']);
  });

  it('TF-пара НЕ применяется если совпадает с текущей (no-op)', () => {
    const onApplyTfPair = vi.fn();
    applySavedResult(makeSaved({ tfPairId: '15m-5m' }), {
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      baseSmcOpts,
      currentTfPairId: '15m-5m',
      onApply: vi.fn(),
      onApplySmc: vi.fn(),
      onApplyTfPair,
    });
    expect(onApplyTfPair).not.toHaveBeenCalled();
  });

  it('legacy saved без tfPairId — callback не вызывается', () => {
    const onApplyTfPair = vi.fn();
    const saved = makeSaved();
    // Legacy: явно удаляем поле (pre-1.36.1 саге его не было).
    delete (saved as { tfPairId?: TfPairId }).tfPairId;
    applySavedResult(saved, {
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      baseSmcOpts,
      currentTfPairId: '15m-5m',
      onApply: vi.fn(),
      onApplySmc: vi.fn(),
      onApplyTfPair,
    });
    expect(onApplyTfPair).not.toHaveBeenCalled();
  });

  it('multiplier callback не вызывается если tickMultiplier undefined', () => {
    const onApplyMultiplier = vi.fn();
    applySavedResult(makeSaved({ dataParams: {} }), {
      baseSettings: DEFAULT_BACKTEST_SETTINGS,
      baseSmcOpts,
      currentTfPairId: '15m-5m',
      onApply: vi.fn(),
      onApplySmc: vi.fn(),
      onApplyMultiplier,
    });
    expect(onApplyMultiplier).not.toHaveBeenCalled();
  });

  it('merge: SMC/BT параметры объединяются с base (не теряются текущие)', () => {
    const onApplySmc = vi.fn();
    const onApply = vi.fn();
    applySavedResult(
      makeSaved({ smcParams: { lookback: 9 }, btParams: { stopPct: 0.3 } }),
      {
        baseSettings: { ...DEFAULT_BACKTEST_SETTINGS, rewardRatio: 3 },
        baseSmcOpts: { ...baseSmcOpts, equalityTolerancePct: 0.001 },
        currentTfPairId: '15m-5m',
        onApply,
        onApplySmc,
      },
    );
    // SMC: lookback из saved (9), но equalityTolerancePct из base (0.001).
    expect(onApplySmc).toHaveBeenCalledWith(
      expect.objectContaining({ lookback: 9, equalityTolerancePct: 0.001 }),
    );
    // BT: stopPct из saved (0.3), но rewardRatio из base (3).
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ stopPct: 0.3, rewardRatio: 3 }),
    );
  });
});
