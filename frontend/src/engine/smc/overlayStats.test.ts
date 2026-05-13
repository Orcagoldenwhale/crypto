import { describe, it, expect } from 'vitest';
import { computeOverlayKindStats, computeTradesByZoneType } from './overlayStats';
import type { BacktestTrade } from '@/backtest/types';
import type { SmcOverlay } from './types';

const EMPTY_OVERLAY: SmcOverlay = {
  fvgs: [],
  liquidity: [],
  structure: [],
  orderBlocks: [],
  breakerBlocks: [],
  rejectionBlocks: [],
  prevDayLevels: [],
  compressions: [],
};

function mkTrade(id: string, zoneId: string, type: BacktestTrade['type']): BacktestTrade {
  return {
    id,
    type,
    zoneId,
    entryNumber: 0,
    entryTime: 1,
    entryPrice: 100,
    stopPrice: 99,
    takePrice: 102,
    outcome: 'win',
    exitTime: 2,
    exitPrice: 102,
    pnlR: 2,
  };
}

describe('computeOverlayKindStats', () => {
  it('пустой overlay → все нули', () => {
    const stats = computeOverlayKindStats(EMPTY_OVERLAY);
    expect(stats.fvg).toEqual({ bull: 0, bear: 0 });
    expect(stats.orderBlocks).toEqual({ bull: 0, bear: 0 });
    expect(stats.breakerBlocks).toEqual({ bull: 0, bear: 0 });
    expect(stats.rejectionBlocks).toEqual({ bull: 0, bear: 0 });
    expect(stats.liquidity).toEqual({ high: 0, low: 0 });
  });

  it('считает bull/bear для OB / BB / RB / FVG', () => {
    const overlay = {
      ...EMPTY_OVERLAY,
      fvgs: [
        { kind: 'bull' as const }, { kind: 'bull' as const }, { kind: 'bear' as const },
      ] as never,
      orderBlocks: [
        { kind: 'bull' as const }, { kind: 'bear' as const }, { kind: 'bear' as const },
      ] as never,
      breakerBlocks: [{ kind: 'bull' as const }] as never,
      rejectionBlocks: [
        { kind: 'bear' as const }, { kind: 'bear' as const }, { kind: 'bear' as const },
      ] as never,
    };
    const stats = computeOverlayKindStats(overlay);
    expect(stats.fvg).toEqual({ bull: 2, bear: 1 });
    expect(stats.orderBlocks).toEqual({ bull: 1, bear: 2 });
    expect(stats.breakerBlocks).toEqual({ bull: 1, bear: 0 });
    expect(stats.rejectionBlocks).toEqual({ bull: 0, bear: 3 });
  });

  it('liquidity считается high/low (не bull/bear)', () => {
    const overlay = {
      ...EMPTY_OVERLAY,
      liquidity: [
        { kind: 'high' as const }, { kind: 'low' as const }, { kind: 'high' as const },
      ] as never,
    };
    expect(computeOverlayKindStats(overlay).liquidity).toEqual({ high: 2, low: 1 });
  });
});

describe('computeTradesByZoneType', () => {
  it('пустой список → все нули', () => {
    const stats = computeTradesByZoneType([]);
    expect(stats.fvg.total).toBe(0);
    expect(stats.ob.total).toBe(0);
    expect(stats.rb.total).toBe(0);
  });

  it('разбивает сделки по префиксу zoneId', () => {
    const trades = [
      mkTrade('t1', 'fvg-bull-100', 'LONG'),
      mkTrade('t2', 'fvg-bear-101', 'SHORT'),
      mkTrade('t3', 'ob-bull-102', 'LONG'),
      mkTrade('t4', 'rb-bear-103', 'SHORT'),
      mkTrade('t5', 'rb-bull-104', 'LONG'),
      mkTrade('t6', 'bb-bull-105', 'LONG'),
    ];
    const stats = computeTradesByZoneType(trades);
    expect(stats.fvg).toEqual({ total: 2, long: 1, short: 1 });
    expect(stats.ob).toEqual({ total: 1, long: 1, short: 0 });
    expect(stats.bb).toEqual({ total: 1, long: 1, short: 0 });
    expect(stats.rb).toEqual({ total: 2, long: 1, short: 1 });
    expect(stats.liq.total).toBe(0);
    expect(stats.unknown.total).toBe(0);
  });

  it('неизвестный prefix падает в unknown', () => {
    const stats = computeTradesByZoneType([
      mkTrade('t1', 'mystery-1', 'LONG'),
    ]);
    expect(stats.unknown).toEqual({ total: 1, long: 1, short: 0 });
  });
});
