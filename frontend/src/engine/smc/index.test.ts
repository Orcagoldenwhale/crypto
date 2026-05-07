/**
 * Интеграционные тесты `runSmcAnalysis` — фокус на глобальном фильтре
 * `hideMitigated`, который чистит уже отработанные элементы во ВСЕХ слоях.
 *
 * Конкретный «правильный» состав каждого слоя на синтетических данных
 * проверяется в отдельных файлах детекторов; здесь же мы убеждаемся, что
 * флаг действительно «прячет» лишнее и не ломает «живые» зоны.
 */

import { describe, expect, it } from 'vitest';
import { runSmcAnalysis } from './index';
import { DEFAULT_SMC_LAYERS, DEFAULT_SMC_OPTIONS } from './types';
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

describe('runSmcAnalysis · hideMitigated', () => {
  // Сценарий, в котором гарантированно есть и «живые», и «отработанные»
  // элементы: bull-FVG, который сразу же mitigated, и затем рост без касания.
  // Берём lookback=2, чтобы не требовать длинного контекста для swing'ов.
  const candles: Candle15m[] = [
    bar(0, 8, 10, 7, 9),
    bar(1, 11, 14, 10.5, 13),     // displacement с FVG между [0] и [2]
    bar(2, 13, 15, 12, 14),       // bull-FVG: 10..12
    bar(3, 12, 13, 11, 12),       // mitigation FVG (low=11 ≤ 12)
    bar(4, 12, 13, 11, 12),
    bar(5, 12, 14, 11, 13.5),
    bar(6, 13.5, 16, 13, 15.5),   // продолжение вверх
    bar(7, 15.5, 17, 14.5, 16.5),
    bar(8, 16.5, 18, 16, 17.5),
  ];

  it('по умолчанию (hideMitigated=false) отдаёт все зоны', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: false,
    });
    // FVG здесь точно один, и он mitigated; остальные слои тоже могут что-то найти.
    expect(overlay.fvgs.length).toBeGreaterThanOrEqual(1);
    const mitigatedFvg = overlay.fvgs.find((f) => !f.unmitigated);
    expect(mitigatedFvg).toBeDefined();
  });

  it('hideMitigated=true прячет mitigated FVG из вывода', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: true,
    });
    // Все возвращённые FVG должны быть «живыми».
    for (const f of overlay.fvgs) {
      expect(f.unmitigated).toBe(true);
    }
  });

  it('hideMitigated=true не пускает Liquidity со sweep, OB с mitigation, Structure с retest', () => {
    const overlay = runSmcAnalysis(candles, DEFAULT_SMC_LAYERS, {
      ...DEFAULT_SMC_OPTIONS,
      lookback: 2,
      hideMitigated: true,
    });
    for (const liq of overlay.liquidity) {
      expect(liq.sweep).toBeNull();
    }
    for (const ob of overlay.orderBlocks) {
      expect(ob.unmitigated).toBe(true);
    }
    for (const sb of overlay.structure) {
      expect(sb.retestTime).toBeNull();
    }
  });

  it('пустой набор слоёв → пустой overlay даже без флага', () => {
    const overlay = runSmcAnalysis(
      candles,
      { fvg: false, liquidity: false, structure: false, orderBlocks: false },
      DEFAULT_SMC_OPTIONS,
    );
    expect(overlay.fvgs).toEqual([]);
    expect(overlay.liquidity).toEqual([]);
    expect(overlay.structure).toEqual([]);
    expect(overlay.orderBlocks).toEqual([]);
  });
});
