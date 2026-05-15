import { describe, it, expect, beforeEach, vi } from 'vitest';
import { snapshotResult, loadOptimizerDefaults, type SavedResult } from './savedResults';
import { DEFAULT_OPTIMIZER_SETTINGS, type OptimizerResult, type OptimizerSettings } from './types';

/** In-memory localStorage стаб для node-env vitest (без jsdom). */
function makeLocalStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  };
}

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

  it('currentScope=null (7д prebuilt) сохраняется явно', () => {
    // null отличается от undefined: undefined = legacy запись без поля,
    // null = «явно 7д prebuilt». Снимок должен сохранить именно null.
    const saved = snapshotResult(dummyOptimizerResult(1), 'composite', {
      symbol: 'BTCUSDT',
      currentScope: null,
    });
    expect('currentScope' in saved).toBe(true);
    expect(saved.currentScope).toBeNull();
  });

  it('currentScope=10000 (35д extended) сохраняется', () => {
    const saved = snapshotResult(dummyOptimizerResult(1), 'composite', {
      symbol: 'TONUSDT',
      currentScope: 10000,
    });
    expect(saved.currentScope).toBe(10000);
  });

  it('source без currentScope — поле в snapshot отсутствует (legacy путь)', () => {
    const saved = snapshotResult(dummyOptimizerResult(1), 'composite', {
      symbol: 'BTCUSDT',
    });
    expect('currentScope' in saved).toBe(false);
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

describe('loadOptimizerDefaults — forward-compat', () => {
  const KEY = 'smc-optimizer-defaults-v1';

  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: makeLocalStorageStub() });
  });

  it('null когда нет сохранённых дефолтов', () => {
    expect(loadOptimizerDefaults()).toBeNull();
  });

  it('legacy settings без новых SmcKey — мерж с DEFAULT даёт полный specs', () => {
    // Старая версия не имела fvgMaxLifetimeCandles, equalityTolerancePct и др.
    // Эмулируем legacy: убираем эти ключи из дефолтных specs.
    const legacy = {
      ...DEFAULT_OPTIMIZER_SETTINGS,
      specs: { ...DEFAULT_OPTIMIZER_SETTINGS.specs },
    } as OptimizerSettings;
    const legacySpecs = legacy.specs as Record<string, unknown>;
    delete legacySpecs.fvgMaxLifetimeCandles;
    delete legacySpecs.equalityTolerancePct;
    delete legacySpecs.liqShowCompression;
    delete legacySpecs.liqCompressionMinPoints;
    window.localStorage.setItem(KEY, JSON.stringify(legacy));

    const loaded = loadOptimizerDefaults();
    expect(loaded).not.toBeNull();
    // Новые ключи должны быть восстановлены из дефолтов.
    expect(loaded!.specs.fvgMaxLifetimeCandles).toBeDefined();
    expect(loaded!.specs.equalityTolerancePct).toBeDefined();
    expect(loaded!.specs.liqShowCompression).toBeDefined();
    expect(loaded!.specs.liqCompressionMinPoints).toBeDefined();
  });

  it('пользовательские настройки приоритетнее дефолтов на пересекающихся ключах', () => {
    const customized = {
      ...DEFAULT_OPTIMIZER_SETTINGS,
      specs: {
        ...DEFAULT_OPTIMIZER_SETTINGS.specs,
        stopPct: { type: 'number', enabled: true, from: 0.5, to: 0.5, step: 0.1 },
      },
    } as OptimizerSettings;
    window.localStorage.setItem(KEY, JSON.stringify(customized));

    const loaded = loadOptimizerDefaults();
    expect(loaded!.specs.stopPct).toMatchObject({ enabled: true, from: 0.5 });
  });

  it('битый JSON → null, не падает', () => {
    window.localStorage.setItem(KEY, 'not-json{');
    expect(loadOptimizerDefaults()).toBeNull();
  });
});
