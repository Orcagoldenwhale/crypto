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
      prevDayLevels: [],
      compressions: [],
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
      prevDayLevels: [],
      compressions: [],
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
      prevDayLevels: [],
      compressions: [],
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
      prevDayLevels: [],
      compressions: [],
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
      prevDayLevels: [],
      compressions: [],
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

  it('entryPoint=mt: вход по Mean Threshold OB-зоны (лимит-ордер на NEXT свече)', () => {
    // 1.46.0: после сигнала на close ставим лимит на MT, fill ищем на
    // следующих свечах (lookahead-safe). Если фили не случился —
    // сделку пропускаем, см. отдельный тест ниже.
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
      signal, // idx=1, LONG signal
      // idx=2: fill-свеча — low=99.5 ≤ MT=100, лимит срабатывает. Не сигнал
      // (close < mid + delta=0), так что повторного входа не случится.
      makeCandle(T0 + MS5 * 2, 100.8, 101, 99.5, 100.2, 0, 100.2, 0, 0),
      // idx=3: TP-свеча — high=108 ≥ entry+risk*R = 100+0.3*2 = 100.6.
      makeCandle(T0 + MS5 * 3, 100.2, 108, 100, 107, 5, 104, -1, 1),
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
    expect(report.trades[0]!.entryPrice).toBe(100);
    // entryTime = fill-свеча (idx=2), а не сигнальная (idx=1) — это и есть
    // фикс lookahead'а.
    expect(report.trades[0]!.entryTime).toBe(T0 + MS5 * 2);
  });

  it('entryPoint=mt: skip если лимит не сработал в окно (нет lookahead)', () => {
    // Сигнал LONG на свече с low=99 (касается MT=100), НО по новой логике
    // фили на сигнальной свече запрещён. На следующих свечах цена не
    // возвращается к MT=100 → лимит не сработал → сделки нет.
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
          endTime: T0 + MS5 * 20,
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
      signal, // idx=1, LONG signal — НО фили на этой же свече запрещён
      // idx=2..6: цена улетает вверх, low всегда > 100, MT не достигается.
      makeCandle(T0 + MS5 * 2, 101, 102, 101, 101.5, 0, 101.5, 0, 0),
      makeCandle(T0 + MS5 * 3, 101.5, 103, 101.2, 102.5, 0, 102.5, 0, 0),
      makeCandle(T0 + MS5 * 4, 102.5, 104, 102, 103.5, 0, 103.5, 0, 0),
      makeCandle(T0 + MS5 * 5, 103.5, 105, 103, 104.5, 0, 104.5, 0, 0),
      makeCandle(T0 + MS5 * 6, 104.5, 106, 104, 105.5, 0, 105.5, 0, 0),
    ];
    const settings: BacktestSettings = {
      ...DEFAULT_BACKTEST_SETTINGS,
      stopPct: 0.3,
      zoneGapPct: 0,
      fvgMaxFillPct: 100,
      entryPoint: 'mt',
    };
    const report = runBacktest(candles, overlay, settings);
    expect(report.totalTrades).toBe(0);
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

  describe('slBehindSwing', () => {
    /**
     * Раскладка свечей: swing-LOW при idx=3 (low=99.8 — строго ниже всех
     * соседей в окне ±3). Сигнал LONG на idx=7. К моменту idx=7 свинг
     * подтверждён (3+3=6 < 7), его можно использовать как кандидата на SL.
     *
     * Зона — bull OB, перекрывает диапазон сигнальной свечи.
     */
    function setupLongSwingScenario(): { overlay: SmcOverlay; candles: Candle5m[] } {
      const overlay: SmcOverlay = {
        fvgs: [],
        liquidity: [],
        structure: [],
        orderBlocks: [{
          id: 'ob1',
          kind: 'bull',
          obTime: T0,
          startTime: T0,
          endTime: T0 + MS5 * 20,
          minPrice: 99,
          maxPrice: 101.5,
          mtPrice: 100.25,
          openPrice: 101,
          hasFvg: false,
          unmitigated: true,
          breakKind: 'BOS',
        }],
        breakerBlocks: [],
        rejectionBlocks: [],
        prevDayLevels: [],
        compressions: [],
      };
      const candles: Candle5m[] = [
        makeCandle(T0,            100,   100.5, 100,   100.2, 0,  100.2, 0, 0),
        makeCandle(T0 + MS5,      100.2, 100.7, 100.1, 100.5, 0,  100.5, 0, 0),
        makeCandle(T0 + MS5 * 2,  100.5, 100.8, 100.2, 100.4, 0,  100.4, 0, 0),
        makeCandle(T0 + MS5 * 3,  100.4, 100.5, 99.8,  100,   0,  100,   0, 0), // swing-LOW
        makeCandle(T0 + MS5 * 4,  100,   100.4, 100,   100.3, 0,  100.3, 0, 0),
        makeCandle(T0 + MS5 * 5,  100.3, 100.5, 100.2, 100.4, 0,  100.4, 0, 0),
        makeCandle(T0 + MS5 * 6,  100.4, 100.6, 100.3, 100.5, 0,  100.5, 0, 0),
        // idx 7: signal LONG, entry=100.8, low=99.5 (но ниже swing — для SL это ok)
        makeCandle(T0 + MS5 * 7,  100.5, 101,   99.5,  100.8, 10, 100.4, -5, 2),
        makeCandle(T0 + MS5 * 8,  100.8, 108,   100,   107,   5,  104,   -1, 1),
      ];
      return { overlay, candles };
    }

    it('LONG: swing-low побеждает pctSl (свинг ближе к entry)', () => {
      const { overlay, candles } = setupLongSwingScenario();
      // stopPct=1% даёт pctSl=99.792; swing-low=99.8 — ближе к entry=100.8.
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 1,
        zoneGapPct: 0,
        fvgMaxFillPct: 100,
        slBehindSwing: true,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
      expect(report.trades[0]!.stopPrice).toBe(99.8);
    });

    it('LONG: pctSl побеждает swing (свинг слишком глубокий)', () => {
      const { overlay, candles } = setupLongSwingScenario();
      // stopPct=0.3% даёт pctSl≈100.4976; swing-low=99.8 — дальше → pctSl wins.
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 0.3,
        zoneGapPct: 0,
        fvgMaxFillPct: 100,
        slBehindSwing: true,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
      expect(report.trades[0]!.stopPrice).toBeCloseTo(100.4976, 3);
    });

    it('SHORT: swing-high побеждает pctSl (зеркальная логика)', () => {
      const overlay: SmcOverlay = {
        fvgs: [],
        liquidity: [],
        structure: [],
        orderBlocks: [{
          id: 'ob1',
          kind: 'bear',
          obTime: T0,
          startTime: T0,
          endTime: T0 + MS5 * 20,
          minPrice: 98,
          maxPrice: 99.5,
          mtPrice: 98.75,
          openPrice: 98,
          hasFvg: false,
          unmitigated: true,
          breakKind: 'BOS',
        }],
        breakerBlocks: [],
        rejectionBlocks: [],
        prevDayLevels: [],
        compressions: [],
      };
      const candles: Candle5m[] = [
        makeCandle(T0,            99.2, 99.3, 99,   99.1, 0,   99.1, 0, 0),
        makeCandle(T0 + MS5,      99.1, 99.4, 99,   99.2, 0,   99.2, 0, 0),
        makeCandle(T0 + MS5 * 2,  99.2, 99.4, 99.1, 99.3, 0,   99.3, 0, 0),
        makeCandle(T0 + MS5 * 3,  99.3, 99.5, 99.2, 99.4, 0,   99.4, 0, 0), // swing-HIGH (h=99.5)
        makeCandle(T0 + MS5 * 4,  99.4, 99.4, 99.2, 99.3, 0,   99.3, 0, 0),
        makeCandle(T0 + MS5 * 5,  99.3, 99.4, 99.1, 99.2, 0,   99.2, 0, 0),
        makeCandle(T0 + MS5 * 6,  99.2, 99.4, 99,   99.1, 0,   99.1, 0, 0),
        // idx 7: signal SHORT (close<mid, delta<0, close<vpoc, delta_at_high>0)
        makeCandle(T0 + MS5 * 7,  99.1, 99.3, 98,   98.5, -10, 99,   2, 5),
        makeCandle(T0 + MS5 * 8,  98.5, 98.7, 92,   93,   -5,  96,   -1, 0),
      ];
      // stopPct=3% даёт pctSl≈101.455; swing-high=99.5 — ближе к entry=98.5.
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 3,
        zoneGapPct: 0,
        fvgMaxFillPct: 100,
        maxCandleBodyPct: 0, // отключаем фильтр (тело сигнала ~0.4% — может задеть)
        slBehindSwing: true,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
      expect(report.trades[0]!.type).toBe('SHORT');
      expect(report.trades[0]!.stopPrice).toBe(99.5);
    });

    it('lookahead-safe: свинг сразу перед сигналом (не подтверждён) — fallback на pctSl', () => {
      // Сигнал в idx=4, swing-LOW в idx=3 → 3+3=6 ≥ 4, свинг ещё не сформирован.
      // SL = pctSl, никаких подсматриваний в будущее.
      const overlay: SmcOverlay = {
        fvgs: [],
        liquidity: [],
        structure: [],
        orderBlocks: [{
          id: 'ob1',
          kind: 'bull',
          obTime: T0,
          startTime: T0,
          endTime: T0 + MS5 * 20,
          minPrice: 99,
          maxPrice: 101.5,
          mtPrice: 100.25,
          openPrice: 101,
          hasFvg: false,
          unmitigated: true,
          breakKind: 'BOS',
        }],
        breakerBlocks: [],
        rejectionBlocks: [],
        prevDayLevels: [],
        compressions: [],
      };
      const candles: Candle5m[] = [
        makeCandle(T0,            100,   100.5, 100,   100.2, 0,  100.2, 0, 0),
        makeCandle(T0 + MS5,      100.2, 100.7, 100.1, 100.5, 0,  100.5, 0, 0),
        makeCandle(T0 + MS5 * 2,  100.5, 100.8, 100.2, 100.4, 0,  100.4, 0, 0),
        makeCandle(T0 + MS5 * 3,  100.4, 100.5, 99.8,  100,   0,  100,   0, 0), // swing-LOW (но ещё не известен на idx=4)
        // idx 4: signal LONG
        makeCandle(T0 + MS5 * 4,  100,   101,   99.5,  100.8, 10, 100.4, -5, 2),
        makeCandle(T0 + MS5 * 5,  100.8, 105,   100,   104,   5,  102,   -1, 1),
        makeCandle(T0 + MS5 * 6,  104,   105,   103,   104,   0,  104,   0, 0),
      ];
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 1,
        zoneGapPct: 0,
        fvgMaxFillPct: 100,
        slBehindSwing: true,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
      // pctSl = 100.8 - 100.8 * 0.01 = 99.792 (swing-low не виден, fallback).
      expect(report.trades[0]!.stopPrice).toBeCloseTo(99.792, 3);
    });
  });

  describe('fvgMaxLifetimeCandles', () => {
    function setupOldFvgScenario(): {
      overlay: SmcOverlay;
      candles: Candle5m[];
    } {
      // FVG сформирован при T0, сигнальная свеча — 50 candles спустя.
      // Возраст = 50 свечей на момент сигнала.
      const overlay: SmcOverlay = {
        fvgs: [{
          id: 'fvg1',
          kind: 'bull',
          startTime: T0,
          endTime: T0 + MS5 * 100,
          minPrice: 99,
          maxPrice: 101,
          unmitigated: true,
        }],
        liquidity: [],
        structure: [],
        orderBlocks: [],
        breakerBlocks: [],
        rejectionBlocks: [],
        prevDayLevels: [],
        compressions: [],
      };
      const candles: Candle5m[] = [];
      // Заполняем 49 нейтральных свеч ВЫШЕ FVG (low=102 > maxPrice=101),
      // чтобы они не заполняли gap и не триггерили fvg_filled.
      for (let i = 0; i < 49; i++) {
        candles.push(makeCandle(T0 + MS5 * i, 103, 104, 102, 103, 0, 103, 0, 0));
      }
      // Свеча 49: signal LONG, попадает в FVG, возраст = 49 candles.
      candles.push(makeCandle(T0 + MS5 * 49, 100, 101, 99, 100.8, 10, 100, -5, 2));
      candles.push(makeCandle(T0 + MS5 * 50, 100.8, 108, 100.5, 107, 5, 104, -1, 1));
      return { overlay, candles };
    }

    it('0 = без ограничения, сделка открывается на старой зоне', () => {
      const { overlay, candles } = setupOldFvgScenario();
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 0.3,
        rewardRatio: 2,
        zoneGapPct: 0,
        maxReentries: 0,
        fvgMaxLifetimeCandles: 0,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
    });

    it('30 свечей — старая FVG (возраст 49) скипается', () => {
      const { overlay, candles } = setupOldFvgScenario();
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 0.3,
        rewardRatio: 2,
        zoneGapPct: 0,
        maxReentries: 0,
        fvgMaxLifetimeCandles: 30,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(0);
    });

    it('100 свечей — возраст 49 проходит, сделка открывается', () => {
      const { overlay, candles } = setupOldFvgScenario();
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 0.3,
        rewardRatio: 2,
        zoneGapPct: 0,
        maxReentries: 0,
        fvgMaxLifetimeCandles: 100,
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
    });

    it('OB-зона не задета лимитом FVG-жизни (проверка избирательности)', () => {
      // Та же выборка свечей, но зона — OB, не FVG. Лимит не должен трогать.
      const overlay: SmcOverlay = {
        fvgs: [],
        liquidity: [],
        structure: [],
        orderBlocks: [{
          id: 'ob1',
          kind: 'bull',
          obTime: T0,
          startTime: T0,
          endTime: T0 + MS5 * 100,
          minPrice: 99,
          maxPrice: 101,
          mtPrice: 100,
          openPrice: 100,
          hasFvg: false,
          unmitigated: true,
          breakKind: 'BOS',
        }],
        breakerBlocks: [],
        rejectionBlocks: [],
        prevDayLevels: [],
        compressions: [],
      };
      const candles: Candle5m[] = [];
      for (let i = 0; i < 49; i++) {
        candles.push(makeCandle(T0 + MS5 * i, 100, 101, 99, 100, 0, 100, 0, 0));
      }
      candles.push(makeCandle(T0 + MS5 * 49, 100, 101, 99, 100.8, 10, 100, -5, 2));
      candles.push(makeCandle(T0 + MS5 * 50, 100.8, 108, 100.5, 107, 5, 104, -1, 1));
      const settings: BacktestSettings = {
        ...DEFAULT_BACKTEST_SETTINGS,
        stopPct: 0.3,
        rewardRatio: 2,
        zoneGapPct: 0,
        maxReentries: 0,
        fvgMaxLifetimeCandles: 10, // жёсткий лимит — но OB не FVG
      };
      const report = runBacktest(candles, overlay, settings);
      expect(report.totalTrades).toBe(1);
    });
  });
});
