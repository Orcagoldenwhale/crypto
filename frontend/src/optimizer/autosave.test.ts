import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAutosave, saveAutosave, clearAutosave, type AutosaveEntry } from './autosave';
import { DEFAULT_OPTIMIZER_SETTINGS } from './types';

/** Тот же in-memory localStorage стаб что в savedResults.test.ts — node-env vitest без jsdom. */
function makeStore(): Storage {
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

function makeEntry(overrides: Partial<AutosaveEntry> = {}): AutosaveEntry {
  return {
    startedAt: 1_700_000_000_000,
    updatedAt: Date.now(),
    processed: 1234,
    totalCombos: 50000,
    top: [],
    optSettings: DEFAULT_OPTIMIZER_SETTINGS,
    symbol: 'TONUSDT',
    tfPairId: '15m-5m',
    smcLayers: {
      fvg: true, liquidity: false, structure: true,
      orderBlocks: true, breakerBlocks: false, rejectionBlocks: false,
    },
    currentScope: 25000,
    ...overrides,
  };
}

describe('autosave', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: makeStore() });
  });

  it('save → load roundtrip сохраняет все поля', () => {
    const entry = makeEntry();
    saveAutosave(entry);
    const loaded = loadAutosave();
    expect(loaded).not.toBeNull();
    expect(loaded!.processed).toBe(1234);
    expect(loaded!.totalCombos).toBe(50000);
    expect(loaded!.symbol).toBe('TONUSDT');
    expect(loaded!.tfPairId).toBe('15m-5m');
    expect(loaded!.currentScope).toBe(25000);
    expect(loaded!.smcLayers.fvg).toBe(true);
    expect(loaded!.smcLayers.liquidity).toBe(false);
  });

  it('пустой localStorage → load возвращает null', () => {
    expect(loadAutosave()).toBeNull();
  });

  it('clear → load возвращает null', () => {
    saveAutosave(makeEntry());
    clearAutosave();
    expect(loadAutosave()).toBeNull();
  });

  it('запись старше 48ч считается устаревшей (null)', () => {
    const stale = makeEntry({
      updatedAt: Date.now() - 49 * 60 * 60 * 1000,
    });
    saveAutosave(stale);
    expect(loadAutosave()).toBeNull();
  });

  it('запись в пределах 48ч живая', () => {
    const fresh = makeEntry({
      updatedAt: Date.now() - 12 * 60 * 60 * 1000,
    });
    saveAutosave(fresh);
    expect(loadAutosave()).not.toBeNull();
  });

  it('повреждённый JSON → load возвращает null, не падает', () => {
    window.localStorage.setItem('smc-optimizer-autosave-v1', '{not valid json');
    expect(loadAutosave()).toBeNull();
  });

  it('запись без обязательных полей → null', () => {
    window.localStorage.setItem(
      'smc-optimizer-autosave-v1',
      JSON.stringify({ processed: 100 }), // нет updatedAt, symbol, optSettings...
    );
    expect(loadAutosave()).toBeNull();
  });

  it('последовательные save-ы — последний выигрывает', () => {
    saveAutosave(makeEntry({ processed: 100 }));
    saveAutosave(makeEntry({ processed: 200 }));
    saveAutosave(makeEntry({ processed: 300 }));
    expect(loadAutosave()!.processed).toBe(300);
  });

  it('null currentScope (7д prebuilt) сохраняется и читается', () => {
    saveAutosave(makeEntry({ currentScope: null }));
    expect(loadAutosave()!.currentScope).toBeNull();
  });
});
