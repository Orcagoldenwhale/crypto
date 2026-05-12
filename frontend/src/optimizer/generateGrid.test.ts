import { describe, it, expect } from 'vitest';
import { countCombinations, generateGrid } from './generateGrid';
import { DEFAULT_OPTIMIZER_SETTINGS, type OptimizerSpecs } from './types';

function makeSpecs(overrides: Partial<OptimizerSpecs>): OptimizerSpecs {
  // Стартуем с дефолтов и выключаем всё кроме того, что задано.
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

  it('одиночный числовой параметр: считает шаги корректно', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
    });
    // 0.1, 0.2, 0.3, 0.4, 0.5 = 5 значений
    expect(countCombinations(specs)).toBe(5);
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual({ stopPct: 0.1 });
    expect(grid[4]).toEqual({ stopPct: 0.5 });
  });

  it('декартово произведение двух параметров', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.3, step: 0.1 },
      rewardRatio: { type: 'number', enabled: true, from: 1, to: 2, step: 1 },
    });
    expect(countCombinations(specs)).toBe(3 * 2);
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(6);
    // Все пары должны быть уникальны.
    const keys = new Set(grid.map((c) => `${c.stopPct}|${c.rewardRatio}`));
    expect(keys.size).toBe(6);
  });

  it('bool с bothValues=true даёт 2 значения', () => {
    const specs = makeSpecs({
      reentryAfterWin: { type: 'bool', enabled: true, bothValues: true },
    });
    expect(countCombinations(specs)).toBe(2);
    const grid = generateGrid(specs);
    expect(grid).toEqual(
      expect.arrayContaining([{ reentryAfterWin: false }, { reentryAfterWin: true }]),
    );
  });

  it('enum: перебирает только указанные значения', () => {
    const specs = makeSpecs({
      entryPoint: { type: 'enum', enabled: true, values: ['close', 'mt'] },
    });
    expect(countCombinations(specs)).toBe(2);
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(2);
  });

  it('не накапливает ошибку плавающей точки', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 1.0, step: 0.1 },
    });
    const grid = generateGrid(specs);
    expect(grid).toHaveLength(10);
    // Последнее значение должно быть точно 1.0 (с точностью 6 знаков).
    expect(grid[9]!.stopPct).toBe(1);
  });
});
