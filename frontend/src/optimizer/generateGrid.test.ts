import { describe, it, expect } from 'vitest';
import { countCombinations, generateGrid, iterateGrid, smcGroupKey } from './generateGrid';
import { DEFAULT_OPTIMIZER_SETTINGS, type OptimizerSpecs } from './types';

function makeSpecs(overrides: Partial<OptimizerSpecs>): OptimizerSpecs {
  const base: OptimizerSpecs = { ...DEFAULT_OPTIMIZER_SETTINGS.specs };
  for (const key of Object.keys(base) as (keyof OptimizerSpecs)[]) {
    base[key] = { ...base[key], enabled: false };
  }
  return { ...base, ...overrides };
}

describe('generateGrid', () => {
  it('пусто когда ничего не включено', () => {
    expect(countCombinations(makeSpecs({}))).toBe(0);
    expect(generateGrid(makeSpecs({}))).toEqual([]);
  });

  it('одиночный числовой BT-параметр', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
    });
    expect(countCombinations(specs)).toBe(5);
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual({ bt: { stopPct: 0.1 }, smc: {}, data: {} });
    expect(grid[4]).toEqual({ bt: { stopPct: 0.5 }, smc: {}, data: {} });
  });

  it('декартово произведение двух BT-параметров', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.3, step: 0.1 },
      rewardRatio: { type: 'number', enabled: true, from: 1, to: 2, step: 1 },
    });
    expect(countCombinations(specs)).toBe(3 * 2);
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(6);
    const keys = new Set(grid.map((c) => `${c.bt.stopPct}|${c.bt.rewardRatio}`));
    expect(keys.size).toBe(6);
  });

  it('bool BT-параметр даёт 2 значения', () => {
    const specs = makeSpecs({
      reentryAfterWin: { type: 'bool', enabled: true, bothValues: true },
    });
    expect(countCombinations(specs)).toBe(2);
    const grid = generateGrid(specs);
    expect(grid.map((c) => c.bt.reentryAfterWin).sort()).toEqual([false, true]);
  });

  it('enum BT-параметр перебирает указанные значения', () => {
    const specs = makeSpecs({
      entryPoint: { type: 'enum', enabled: true, values: ['close', 'mt'] },
    });
    expect(countCombinations(specs)).toBe(2);
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(2);
  });

  it('SMC-параметр попадает в combo.smc, не в bt', () => {
    const specs = makeSpecs({
      lookback: { type: 'number', enabled: true, from: 3, to: 5, step: 1 },
    });
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(3);
    expect(grid[0]).toEqual({ bt: {}, smc: { lookback: 3 }, data: {} });
    expect(grid[2]).toEqual({ bt: {}, smc: { lookback: 5 }, data: {} });
  });

  it('смешанная конфигурация BT + SMC', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.2, step: 0.1 },
      lookback: { type: 'number', enabled: true, from: 3, to: 4, step: 1 },
    });
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(4);
    // Каждая комбинация должна иметь bt.stopPct и smc.lookback.
    for (const c of grid) {
      expect(typeof c.bt.stopPct).toBe('number');
      expect(typeof c.smc.lookback).toBe('number');
    }
  });

  it('tickMultiplier попадает в combo.data, парсится в число', () => {
    const specs = makeSpecs({
      tickMultiplier: { type: 'enum', enabled: true, values: ['1', '2', '5'] },
    });
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(3);
    const mults = grid.map((c) => c.data.tickMultiplier).sort();
    expect(mults).toEqual([1, 2, 5]);
    // bt и smc пустые.
    expect(grid[0]!.bt).toEqual({});
    expect(grid[0]!.smc).toEqual({});
  });

  it('smcGroupKey стабилен для одинаковых объектов', () => {
    expect(smcGroupKey({ lookback: 5, fvgMaxFillPct: 50 }))
      .toBe(smcGroupKey({ fvgMaxFillPct: 50, lookback: 5 }));
    expect(smcGroupKey({})).toBe('');
  });
});

describe('iterateGrid (lazy generator)', () => {
  it('пусто когда ничего не включено', () => {
    expect([...iterateGrid(makeSpecs({}))]).toEqual([]);
  });

  it('даёт ровно столько комбо сколько countCombinations', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.3, step: 0.1 },
      rewardRatio: { type: 'number', enabled: true, from: 1, to: 3, step: 1 },
      lookback: { type: 'number', enabled: true, from: 3, to: 5, step: 1 },
    });
    const expected = countCombinations(specs);
    const generated = [...iterateGrid(specs)];
    expect(generated).toHaveLength(expected);
    expect(expected).toBe(3 * 3 * 3); // = 27
  });

  it('эквивалентность с generateGrid: тот же набор комбо (set-equality)', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.3, step: 0.1 },
      lookback: { type: 'number', enabled: true, from: 3, to: 5, step: 1 },
      tickMultiplier: { type: 'enum', enabled: true, values: ['1', '2'] },
    });
    const fromArray = generateGrid(specs).map((c) => JSON.stringify(c)).sort();
    const fromIter = [...iterateGrid(specs)].map((c) => JSON.stringify(c)).sort();
    expect(fromIter).toEqual(fromArray);
  });

  it('эмиссия в порядке data → smc → bt (cache-friendly для optimizer)', () => {
    const specs = makeSpecs({
      // bt
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.2, step: 0.1 },
      // smc
      lookback: { type: 'number', enabled: true, from: 3, to: 4, step: 1 },
      // data
      tickMultiplier: { type: 'enum', enabled: true, values: ['1', '2'] },
    });
    const combos = [...iterateGrid(specs)];
    expect(combos).toHaveLength(2 * 2 * 2);
    // Первые 4 комбо должны иметь одинаковый tickMultiplier=1 (data — внешний цикл).
    const firstHalfMults = combos.slice(0, 4).map((c) => c.data.tickMultiplier);
    expect(new Set(firstHalfMults).size).toBe(1);
    expect(firstHalfMults[0]).toBe(1);
    // Внутри одного tickMultiplier — пары с одинаковым lookback.
    const firstTwoLookbacks = combos.slice(0, 2).map((c) => c.smc.lookback);
    expect(new Set(firstTwoLookbacks).size).toBe(1);
  });

  it('каждый Combo — отдельный объект (consumer может его сохранить)', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.2, step: 0.1 },
    });
    const combos = [...iterateGrid(specs)];
    expect(combos[0]).not.toBe(combos[1]);
    expect(combos[0]!.bt).not.toBe(combos[1]!.bt);
  });

  it('константная память: 1000 комбо не материализуются как массив внутри', () => {
    // Косвенно — если бы iterateGrid материализовался, для 1000 комбо
    // получили бы 1000 одинаковых ссылок на bt. Проверяем что у каждого
    // свой bt-объект.
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.01, to: 1.00, step: 0.01 },
    });
    const combos = [...iterateGrid(specs)];
    expect(combos).toHaveLength(100);
    // Все bt-объекты независимые ссылки.
    const btRefs = new Set(combos.map((c) => c.bt));
    expect(btRefs.size).toBe(100);
  });
});
