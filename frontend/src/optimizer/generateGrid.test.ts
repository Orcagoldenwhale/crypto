import { describe, it, expect } from 'vitest';
import { countCombinations, generateGrid, smcGroupKey } from './generateGrid';
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
