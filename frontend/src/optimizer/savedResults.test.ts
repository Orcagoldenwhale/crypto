import { describe, it, expect } from 'vitest';
import { snapshotResult, type SavedResult } from './savedResults';
import type { OptimizerResult } from './types';

function dummyOptimizerResult(score: number): OptimizerResult {
  return {
    btParams: { stopPct: 0.5 },
    smcParams: { lookback: 5 },
    dataParams: { tickMultiplier: 2 },
    score,
    report: {
      totalTrades: 10,
      wins: 6,
      losses: 4,
      openTrades: 0,
      winRate: 0.6,
      totalPnlR: 5,
      avgPnlR: 0.5,
      maxConsecutiveLosses: 2,
      trades: [],
    },
  };
}

describe('snapshotResult (Saved/History labels — 1.36.1)', () => {
  it('без source — symbol/tfPairId отсутствуют (старое поведение)', () => {
    const saved = snapshotResult(dummyOptimizerResult(1), 'composite');
    expect('symbol' in saved).toBe(false);
    expect('tfPairId' in saved).toBe(false);
  });

  it('с source — symbol/tfPairId сохраняются', () => {
    const saved = snapshotResult(dummyOptimizerResult(1), 'composite', {
      symbol: 'BTCUSDT',
      tfPairId: '15m-5m',
    });
    expect(saved.symbol).toBe('BTCUSDT');
    expect(saved.tfPairId).toBe('15m-5m');
  });

  it('JSON round-trip сохраняет новые поля (для localStorage)', () => {
    const saved = snapshotResult(dummyOptimizerResult(2), 'totalPnlR', {
      symbol: 'ETHUSDT',
      tfPairId: '5m-5m',
    });
    const reparsed = JSON.parse(JSON.stringify(saved)) as SavedResult;
    expect(reparsed.symbol).toBe('ETHUSDT');
    expect(reparsed.tfPairId).toBe('5m-5m');
    expect(reparsed.score).toBe(2);
  });

  it('partial source (только symbol, без tfPairId) — корректно обрабатывается', () => {
    const saved = snapshotResult(dummyOptimizerResult(3), 'composite', {
      symbol: 'BNBUSDT',
    });
    expect(saved.symbol).toBe('BNBUSDT');
    expect('tfPairId' in saved).toBe(false);
  });

  it('summary заполняется из BacktestReport', () => {
    const saved = snapshotResult(dummyOptimizerResult(1), 'winRate');
    expect(saved.summary).toEqual({
      totalTrades: 10,
      wins: 6,
      losses: 4,
      openTrades: 0,
      winRate: 0.6,
      totalPnlR: 5,
      avgPnlR: 0.5,
      maxConsecutiveLosses: 2,
    });
  });
});
