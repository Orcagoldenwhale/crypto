import { describe, it, expect } from 'vitest';
import { runBacktest } from './runBacktest';
import type { Candle5m } from '@/types';
import type { SmcOverlay } from '@/engine/smc/types';
import type { BacktestSettings } from './types';
import { DEFAULT_BACKTEST_SETTINGS } from './types';

function makeCandle(
  timestamp: number,
  o: number,
  h: number,
  l: number,
  c: number,
  delta: number,
  vpoc: number,
  deltaAtLow: number,
  deltaAtHigh: number,
): Candle5m {
  return {
    timestamp,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 100,
    delta,
    vpoc_price: vpoc,
    max_vol: 50,
    delta_at_low: deltaAtLow,
    delta_at_high: deltaAtHigh,
    clusters: [],
  };
}

const T0 = 1_700_000_000_000;
const MS5 = 5 * 60 * 1000;

describe('runBacktest', () => {
  it('finds a LONG signal in FVG zone and resolves win', () => {
    const overlay: SmcOverlay = {
      fvgs: [
        {
          id: 'fvg1',
          kind: 'bull',
          startTime: T0,
          endTime: T0 + MS5 * 10,
          minPrice: 99,
          maxPrice: 101,
          unmitigated: true,
        },
      ],
      liquidity: [],
      structure: [],
      orderBlocks: [],
      breakerBlocks: [],
      rejectionBlocks: [],
    };

    // LONG signal: close > mid, delta > 0, close > vpoc, delta_at_low < 0
    // entry = 100.8, stop = 100.8 - 100.8*0.003 = 100.4976, risk ≈ 0.3024
    // take = 100.8 + 0.3024*2 ≈ 101.4048 → next candle high=108 covers it
    const signalCandle = makeCandle(T0 + MS5, 100, 101, 99, 100.8, 10, 100, -5, 2);
    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100, 0, 100, 0, 0),
      signalCandle,
      makeCandle(T0 + MS5 * 2, 100.8, 108, 100.5, 107, 5, 104, -1, 1),
    ];

    const settings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      rewardRatio: 2,
      zoneGapPct: 0,
      maxReentries: 0,
    };

    const report = runBacktest(candles, overlay, settings);

    expect(report.totalTrades).toBe(1);
    expect(report.trades[0]!.type).toBe('LONG');
    expect(report.trades[0]!.outcome).toBe('win');
    expect(report.trades[0]!.pnlR).toBe(2);
    expect(report.winRate).toBe(1);
  });

  it('returns empty report when no SMC zones', () => {
    const overlay: SmcOverlay = {
      fvgs: [],
      liquidity: [],
      structure: [],
      orderBlocks: [],
      breakerBlocks: [],
      rejectionBlocks: [],
    };

    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100.8, 10, 100, -5, 2),
    ];

    const report = runBacktest(candles, overlay, DEFAULT_BACKTEST_SETTINGS);
    expect(report.totalTrades).toBe(0);
  });

  it('respects maxReentries limit', () => {
    const overlay: SmcOverlay = {
      fvgs: [
        {
          id: 'fvg1',
          kind: 'bull',
          startTime: T0,
          endTime: T0 + MS5 * 20,
          minPrice: 95,
          maxPrice: 105,
          unmitigated: true,
        },
      ],
      liquidity: [],
      structure: [],
      orderBlocks: [],
      breakerBlocks: [],
      rejectionBlocks: [],
    };

    // Two LONG signals followed by stop-outs
    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100.8, 10, 100, -5, 2), // signal 1
      makeCandle(T0 + MS5, 100.8, 100.9, 96, 96.5, -5, 98, 0, 0), // stop hit
      makeCandle(T0 + MS5 * 2, 100, 101, 99, 100.8, 10, 100, -5, 2), // signal 2
      makeCandle(T0 + MS5 * 3, 100.8, 100.9, 96, 96.5, -5, 98, 0, 0), // stop hit
      makeCandle(T0 + MS5 * 4, 100, 101, 99, 100.8, 10, 100, -5, 2), // signal 3 — should be blocked
      makeCandle(T0 + MS5 * 5, 100.8, 110, 100.5, 109, 5, 105, -1, 1),
    ];

    const settings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      maxReentries: 1,
      zoneGapPct: 0,
      fvgMaxFillPct: 100,
    };

    const report = runBacktest(candles, overlay, settings);
    // First entry + 1 reentry = 2 trades max
    expect(report.totalTrades).toBe(2);
  });

  it('skips FVG zone when fill exceeds fvgMaxFillPct', () => {
    const overlay: SmcOverlay = {
      fvgs: [
        {
          id: 'fvg1',
          kind: 'bull',
          startTime: T0,
          endTime: T0 + MS5 * 10,
          minPrice: 100,
          maxPrice: 102,
          unmitigated: true,
        },
      ],
      liquidity: [],
      structure: [],
      orderBlocks: [],
      breakerBlocks: [],
      rejectionBlocks: [],
    };

    // Candle 1 fills FVG 75% (low=101.5 → penetration=(102-101.5)/2=25%... no)
    // Bull FVG [100,102], height=2. Candle low penetrates from top.
    // fill = (fvgMaxPrice - candle.low) / height = (102 - low) / 2
    // Candle 1 (non-signal): low=100.5 → fill=(102-100.5)/2=75%
    // Candle 2 (signal): should be blocked if fvgMaxFillPct=50
    const candles: Candle5m[] = [
      makeCandle(T0, 101, 103, 101, 101, 0, 101, 0, 0),
      makeCandle(T0 + MS5, 101, 102, 100.5, 101, 0, 101, 0, 0),
      makeCandle(T0 + MS5 * 2, 101, 102, 100, 101.5, 10, 100.5, -5, 2),
      makeCandle(T0 + MS5 * 3, 101.5, 110, 101, 109, 5, 105, -1, 1),
    ];

    // With fvgMaxFillPct=50 → zone filled 75%, blocked
    const settingsStrict: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      zoneGapPct: 0,
      fvgMaxFillPct: 50,
    };
    expect(runBacktest(candles, overlay, settingsStrict).totalTrades).toBe(0);

    // With fvgMaxFillPct=80 → zone filled 75%, allowed
    const settingsRelaxed: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      zoneGapPct: 0,
      fvgMaxFillPct: 80,
    };
    expect(runBacktest(candles, overlay, settingsRelaxed).totalTrades).toBe(1);
  });

  it('calculates stop as percentage of entry price', () => {
    const overlay: SmcOverlay = {
      fvgs: [
        {
          id: 'fvg1',
          kind: 'bull',
          startTime: T0,
          endTime: T0 + MS5 * 10,
          minPrice: 99,
          maxPrice: 101,
          unmitigated: true,
        },
      ],
      liquidity: [],
      structure: [],
      orderBlocks: [],
      breakerBlocks: [],
      rejectionBlocks: [],
    };

    // close=100.5 > mid=(101+99)/2=100 ✓, delta>0 ✓, close>vpoc ✓, delta_at_low<0 ✓
    const signalCandle = makeCandle(T0 + MS5, 99.5, 101, 99, 100.5, 10, 99.5, -5, 2);
    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100, 0, 100, 0, 0),
      signalCandle,
      makeCandle(T0 + MS5 * 2, 100, 101, 99, 100, 0, 100, 0, 0),
    ];

    const settings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 1, // 1% of entry price
      zoneGapPct: 0,
    };

    const report = runBacktest(candles, overlay, settings);
    expect(report.totalTrades).toBe(1);
    // entry = 100.5, stop = 100.5 - 100.5*0.01 = 99.495
    expect(report.trades[0]!.stopPrice).toBeCloseTo(99.495, 3);
    // risk = 1.005, take = 100.5 + 1.005*2 = 102.51
    expect(report.trades[0]!.takePrice).toBeCloseTo(102.51, 3);
  });

  it('entryPoint=mt: вход по Mean Threshold OB-зоны', () => {
    // Bull OB зона с MT=100. Сигнальная свеча low=99 (достаёт MT).
    const overlay: SmcOverlay = {
      fvgs: [],
      liquidity: [],
      structure: [],
      orderBlocks: [
        {
          id: 'ob1',
          kind: 'bull',
          obTime: T0,
          startTime: T0,
          endTime: T0 + MS5 * 10,
          minPrice: 98,
          maxPrice: 102,
          mtPrice: 100,
          openPrice: 102,
          hasFvg: false,
          unmitigated: true,
          breakKind: 'BOS',
        },
      ],
      breakerBlocks: [],
      rejectionBlocks: [],
      prevDayLevels: [],
      compressions: [],
    };
    const signal = makeCandle(T0 + MS5, 100, 101, 99, 100.8, 10, 100, -5, 2);
    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100, 0, 100, 0, 0),
      signal,
      makeCandle(T0 + MS5 * 2, 100.8, 108, 100.5, 107, 5, 104, -1, 1),
    ];
    const settings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      zoneGapPct: 0,
      fvgMaxFillPct: 100,
      entryPoint: 'mt',
    };
    const report = runBacktest(candles, overlay, settings);
    expect(report.totalTrades).toBe(1);
    // Entry должен быть равен MT = 100, а не close=100.8.
    expect(report.trades[0]!.entryPrice).toBe(100);
  });

  it('slBehindObWick: SL — ближайший из (stopPct, фитиль OB)', () => {
    const overlay: SmcOverlay = {
      fvgs: [],
      liquidity: [],
      structure: [],
      orderBlocks: [
        {
          id: 'ob1',
          kind: 'bull',
          obTime: T0,
          startTime: T0,
          endTime: T0 + MS5 * 10,
          minPrice: 95,
          maxPrice: 102,
          mtPrice: 98.5,
          openPrice: 102,
          hasFvg: false,
          unmitigated: true,
          breakKind: 'BOS',
        },
      ],
      breakerBlocks: [],
      rejectionBlocks: [],
      prevDayLevels: [],
      compressions: [],
    };
    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100, 0, 100, 0, 0),
      makeCandle(T0 + MS5, 100, 101, 99, 100.8, 10, 100, -5, 2),
      makeCandle(T0 + MS5 * 2, 100.8, 108, 100.5, 107, 5, 104, -1, 1),
    ];
    // Случай A: stopPct=10% даёт SL=90.72 — фитиль (95) ближе → SL=95.
    const looseSettings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 10,
      zoneGapPct: 0,
      fvgMaxFillPct: 100,
      slBehindObWick: true,
    };
    const looseReport = runBacktest(candles, overlay, looseSettings);
    expect(looseReport.trades[0]!.stopPrice).toBe(95);

    // Случай B: stopPct=0.3% даёт SL≈100.5 — он ближе чем фитиль (95).
    // SL = stopPct SL (фитиль слишком далеко, рискнули бы лишнее).
    const tightSettings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      zoneGapPct: 0,
      fvgMaxFillPct: 100,
      slBehindObWick: true,
    };
    const tightReport = runBacktest(candles, overlay, tightSettings);
    expect(tightReport.trades[0]!.stopPrice).toBeCloseTo(100.4976, 3);
  });

  it('slBehindFvgEdge: SL устанавливается на дальней границе FVG', () => {
    const overlay: SmcOverlay = {
      fvgs: [
        {
          id: 'fvg1',
          kind: 'bull',
          startTime: T0,
          endTime: T0 + MS5 * 10,
          minPrice: 99,
          maxPrice: 101,
          unmitigated: true,
        },
      ],
      liquidity: [],
      structure: [],
      orderBlocks: [],
      breakerBlocks: [],
      rejectionBlocks: [],
      prevDayLevels: [],
      compressions: [],
    };
    const candles: Candle5m[] = [
      makeCandle(T0, 100, 101, 99, 100, 0, 100, 0, 0),
      makeCandle(T0 + MS5, 100, 101, 99, 100.8, 10, 100, -5, 2),
      makeCandle(T0 + MS5 * 2, 100.8, 108, 100.5, 107, 5, 104, -1, 1),
    ];
    // С большим stopPct (5%) фитиль FVG (99) ближе чем pctSl (95.76) → SL=99.
    const settings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 5,
      zoneGapPct: 0,
      fvgMaxFillPct: 100,
      slBehindFvgEdge: true,
    };
    const report = runBacktest(candles, overlay, settings);
    expect(report.totalTrades).toBe(1);
    expect(report.trades[0]!.stopPrice).toBe(99);
  });
});
