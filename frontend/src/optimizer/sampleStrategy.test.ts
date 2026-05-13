import { describe, it, expect } from 'vitest';
import { sampleRandomCombos, localNeighbors, type Rng } from './sampleStrategy';
import { DEFAULT_OPTIMIZER_SETTINGS, type OptimizerSpecs } from './types';

function makeSpecs(overrides: Partial<OptimizerSpecs>): OptimizerSpecs {
  const base: OptimizerSpecs = { ...DEFAULT_OPTIMIZER_SETTINGS.specs };
  for (const key of Object.keys(base) as (keyof OptimizerSpecs)[]) {
    base[key] = { ...base[key], enabled: false };
  }
  return { ...base, ...overrides };
}

/** Детерминированный RNG для воспроизводимых тестов (mulberry32). */
function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sampleRandomCombos', () => {
  it('пустой grid → пустой массив', () => {
    expect(sampleRandomCombos(makeSpecs({}), 100)).toEqual([]);
  });

  it('n=0 → пустой массив даже на непустом гриде', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
    });
    expect(sampleRandomCombos(specs, 0)).toEqual([]);
  });

  it('возвращает ровно n уникальных комбо', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 1.0, step: 0.01 }, // 91 значение
    });
    const sample = sampleRandomCombos(specs, 20, seededRng(42));
    expect(sample).toHaveLength(20);
    const unique = new Set(sample.map((c) => c.bt.stopPct));
    expect(unique.size).toBe(20);
  });

  it('n >= total → возвращает весь grid (без коллизионных retry бесконечно)', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 }, // 5 значений
    });
    const sample = sampleRandomCombos(specs, 100);
    expect(sample).toHaveLength(5);
  });

  it('детерминирован при одинаковом seed', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 1.0, step: 0.05 }, // 19 значений
      rewardRatio: { type: 'number', enabled: true, from: 1, to: 5, step: 0.5 }, // 9 значений
    });
    const a = sampleRandomCombos(specs, 30, seededRng(123));
    const b = sampleRandomCombos(specs, 30, seededRng(123));
    expect(a.map((c) => JSON.stringify(c))).toEqual(b.map((c) => JSON.stringify(c)));
  });

  it('покрытие разумно равномерное (Sobol-like через random)', () => {
    // Грид 100 значений stopPct. Берём 20 случайных. С high probability
    // охват по диапазону — пара групп.
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.01, to: 1.0, step: 0.01 },
    });
    const sample = sampleRandomCombos(specs, 20, seededRng(7));
    const values = sample.map((c) => c.bt.stopPct as number);
    // Хотя бы что-то выше 0.5 и что-то ниже 0.5.
    expect(values.some((v) => v < 0.5)).toBe(true);
    expect(values.some((v) => v >= 0.5)).toBe(true);
  });

  it('сэмпл всегда валидный Combo с правильной разбивкой bt/smc/data', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.3, step: 0.1 },
      lookback: { type: 'number', enabled: true, from: 3, to: 5, step: 1 },
      tickMultiplier: { type: 'enum', enabled: true, values: ['1', '2'] },
    });
    const sample = sampleRandomCombos(specs, 10, seededRng(99));
    for (const c of sample) {
      expect(typeof c.bt.stopPct).toBe('number');
      expect(typeof c.smc.lookback).toBe('number');
      expect(typeof c.data.tickMultiplier).toBe('number');
    }
  });
});

describe('localNeighbors', () => {
  it('пустой grid → пустой массив', () => {
    const combo = { bt: { stopPct: 0.3 }, smc: {}, data: {} };
    expect(localNeighbors(combo, makeSpecs({}))).toEqual([]);
  });

  it('даёт ±1 соседей по одному параметру', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
    });
    const combo = { bt: { stopPct: 0.3 }, smc: {}, data: {} };
    const neighbors = localNeighbors(combo, specs);
    expect(neighbors).toHaveLength(2); // 0.2, 0.4
    const values = neighbors.map((c) => c.bt.stopPct).sort();
    expect(values).toEqual([0.2, 0.4]);
  });

  it('на границе grid — только один сосед', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
    });
    // combo на левой границе: stopPct=0.1
    const left = localNeighbors({ bt: { stopPct: 0.1 }, smc: {}, data: {} }, specs);
    expect(left).toHaveLength(1);
    expect(left[0]!.bt.stopPct).toBe(0.2);
    // combo на правой границе: stopPct=0.5
    const right = localNeighbors({ bt: { stopPct: 0.5 }, smc: {}, data: {} }, specs);
    expect(right).toHaveLength(1);
    expect(right[0]!.bt.stopPct).toBe(0.4);
  });

  it('два параметра: соседи варьируют по одному за раз', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
      lookback: { type: 'number', enabled: true, from: 3, to: 7, step: 1 },
    });
    const combo = { bt: { stopPct: 0.3 }, smc: { lookback: 5 }, data: {} };
    const neighbors = localNeighbors(combo, specs);
    // 2 (stopPct) + 2 (lookback) = 4
    expect(neighbors).toHaveLength(4);
    // Каждый сосед варьирует ровно один параметр от combo.
    for (const n of neighbors) {
      const diffs =
        Number(n.bt.stopPct !== 0.3) + Number(n.smc.lookback !== 5);
      expect(diffs).toBe(1);
    }
  });

  it('stepRange=2 даёт ±1 и ±2', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.9, step: 0.1 },
    });
    const combo = { bt: { stopPct: 0.5 }, smc: {}, data: {} };
    const neighbors = localNeighbors(combo, specs, 2);
    // ±1, ±2 → 4 соседа
    expect(neighbors).toHaveLength(4);
    const vals = neighbors.map((c) => c.bt.stopPct).sort();
    expect(vals).toEqual([0.3, 0.4, 0.6, 0.7]);
  });

  it('bool параметр: один сосед (flip)', () => {
    const specs = makeSpecs({
      reentryAfterWin: { type: 'bool', enabled: true, bothValues: true },
    });
    const off = localNeighbors({ bt: { reentryAfterWin: false }, smc: {}, data: {} }, specs);
    expect(off).toHaveLength(1);
    expect(off[0]!.bt.reentryAfterWin).toBe(true);
  });

  it('параметр которого нет в combo — пропускается без ошибки', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.5, step: 0.1 },
      lookback: { type: 'number', enabled: true, from: 3, to: 7, step: 1 },
    });
    // В combo нет lookback (legacy). Соседи только по stopPct.
    const combo = { bt: { stopPct: 0.3 }, smc: {}, data: {} };
    const neighbors = localNeighbors(combo, specs);
    expect(neighbors).toHaveLength(2); // только ±1 по stopPct
  });

  it('не возвращает дубликаты и не включает сам combo', () => {
    const specs = makeSpecs({
      stopPct: { type: 'number', enabled: true, from: 0.1, to: 0.3, step: 0.1 },
    });
    const combo = { bt: { stopPct: 0.2 }, smc: {}, data: {} };
    const neighbors = localNeighbors(combo, specs);
    const values = neighbors.map((c) => c.bt.stopPct);
    expect(values).not.toContain(0.2);
    expect(new Set(values).size).toBe(values.length);
  });
});
