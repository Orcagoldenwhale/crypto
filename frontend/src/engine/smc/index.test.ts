/**
 * Интеграционные тесты `runSmcAnalysis` — фокус на per-layer фильтре
 * `hideMitigated.{fvg|liquidity|structure|orderBlocks}`. Каждый тоггл
 * чистит ТОЛЬКО свой слой, не затрагивая остальные.
 *
 * Конкретный «правильный» состав каждого слоя на синтетических данных
 * проверяется в отдельных файлах детекторов; здесь же мы убеждаемся, что
 * флаги действительно «прячут» лишнее и не ломают «живые» зоны.
 */

import { describe, expect, it } from 'vitest';
import { runSmcAnalysis } from './index';
import {
  DEFAULT_HIDE_MITIGATED,
  DEFAULT_SMC_LAYERS,
  DEFAULT_SMC_OPTIONS,
} from './types';
import type { Candle15m } from '@/types';

const T0 = 1700_000_000_000;
const M15 = 15 * 60 * 1000;
const t = (i: number): number => T0 + i * M15;

function bar(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle15m {
  return { timestamp: t(i), open, high, low, close, volume: 0 };
}

// Сценарий, в котором гарантированно есть и «живые», и «отработанные»
// элементы: bull-FVG, который сразу же mitigated, и затем рост без касания.
// lookback=2 — чтобы не требовать длинного контекста для swing'ов.
const candles: Candle15m[] = [
  bar(0, 8, 10, 7, 9),
  bar(1, 11, 14, 10.5, 13), // displacement с FVG между [0] и [2]
  bar(2, 13, 15, 12, 14), // bull-FVG: 10..12
  bar(3, 12, 13, 11, 12), // mitigation FVG (low=11 ≤ 12)
  bar(4, 12, 13, 11, 12),
  bar(5, 12, 14, 11, 13.5),
  bar(6, 13.5, 16, 13, 15.5), // продолжение вверх
  bar(7, 15.5, 17, 14.5, 16.5),
  bar(8, 16.5, 18, 16, 17.5),
];

describe('runSmcAnalysis · per-layer hideMitigated', () => {
  it('по умолчанию (все флаги false) отдаёт все зоны, включая mitigated FVG', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: { ...DEFAULT_HIDE_MITIGATED },
    });
    expect(overlay.fvgs.length).toBeGreaterThanOrEqual(1);
    const mitigatedFvg = overlay.fvgs.find((f) => !f.unmitigated);
    expect(mitigatedFvg).toBeDefined();
  });

  it('hideMitigated.fvg=true прячет mitigated FVG, но не трогает другие слои', () => {
    const baseline = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: { ...DEFAULT_HIDE_MITIGATED },
    });
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: { ...DEFAULT_HIDE_MITIGATED, fvg: true },
    });
    // FVG: после фильтра остаются только живые.
    for (const f of overlay.fvgs) expect(f.unmitigated).toBe(true);
    // Liquidity / Structure / OB должны быть идентичны базовому прогону —
    // другие тогглы не активны.
    expect(overlay.liquidity).toEqual(baseline.liquidity);
    expect(overlay.structure).toEqual(baseline.structure);
    expect(overlay.orderBlocks).toEqual(baseline.orderBlocks);
  });

  it('hideMitigated.liquidity=true прячет только swept-ловушки', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: { ...DEFAULT_HIDE_MITIGATED, liquidity: true },
    });
    for (const liq of overlay.liquidity) expect(liq.sweep).toBeNull();
    // Должен оставаться mitigated FVG (другой тоггл).
    const hasMitigatedFvg = overlay.fvgs.some((f) => !f.unmitigated);
    expect(hasMitigatedFvg).toBe(true);
  });

  it('hideMitigated.structure=true прячет только ретестнутые break\u2019и', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: { ...DEFAULT_HIDE_MITIGATED, structure: true },
    });
    for (const sb of overlay.structure) expect(sb.retestTime).toBeNull();
  });

  it('hideMitigated.orderBlocks=true прячет только отработанные OB', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: { ...DEFAULT_HIDE_MITIGATED, orderBlocks: true },
    });
    for (const ob of overlay.orderBlocks) expect(ob.unmitigated).toBe(true);
  });

  it('все четыре флага true — каждый слой отдаёт только «живое»', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: {
        fvg: true,
        liquidity: true,
        structure: true,
        orderBlocks: true,
      },
    });
    for (const f of overlay.fvgs) expect(f.unmitigated).toBe(true);
    for (const liq of overlay.liquidity) expect(liq.sweep).toBeNull();
    for (const sb of overlay.structure) expect(sb.retestTime).toBeNull();
    for (const ob of overlay.orderBlocks) expect(ob.unmitigated).toBe(true);
  });

  it('пустой набор слоёв → пустой overlay даже с включёнными флагами', () => {
    const overlay = runSmcAnalysis(
      candles,
      { fvg: false, liquidity: false, structure: false, orderBlocks: false },
      {
        ...DEFAULT_SMC_OPTIONS,
        hideMitigated: {
          fvg: true,
          liquidity: true,
          structure: true,
          orderBlocks: true,
        },
      },
    );
    expect(overlay.fvgs).toEqual([]);
    expect(overlay.liquidity).toEqual([]);
    expect(overlay.structure).toEqual([]);
    expect(overlay.orderBlocks).toEqual([]);
  });
});
