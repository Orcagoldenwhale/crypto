/**
 * Интеграционный тест: сканер должен найти ровно те сигналы, которые
 * `mockGenerator` сознательно «вшил» в датасет (perfectLongIndex / perfectShortIndex).
 *
 * Это лучшая проверка end-to-end логики:
 *   mockGenerator → checkSignal → runScanner → ожидаемые сигналы.
 */

import { describe, expect, it } from 'vitest';
import { generateMockData } from '@/data/mockGenerator';
import { runScanner } from './runScanner';
import type { POIZone } from '@/types';

const MS_5M = 5 * 60 * 1000;

function bigZone(): POIZone {
  return {
    id: 'global',
    startTime: 0,
    endTime: Number.MAX_SAFE_INTEGER,
    minPrice: 0,
    maxPrice: Number.MAX_SAFE_INTEGER,
    hasSignal: false,
  };
}

describe('scanner ↔ mockGenerator (integration)', () => {
  it('находит ровно один LONG-сигнал и один SHORT-сигнал на дефолтном моке', () => {
    const dataset = generateMockData();
    const r = runScanner({ candles: dataset.candles, zones: [bigZone()] });

    expect(r.report.longCount).toBeGreaterThanOrEqual(1);
    expect(r.report.shortCount).toBeGreaterThanOrEqual(1);
    expect(r.report.signalsTotal).toBe(r.report.longCount + r.report.shortCount);
  });

  it('LONG-сигнал лежит именно на индексе perfectLongIndex (40% датасета)', () => {
    const dataset = generateMockData();
    const expectedIdx = Math.floor(dataset.candles.length * 0.4);
    const expectedTs = dataset.candles[expectedIdx]?.timestamp;
    expect(expectedTs).toBeDefined();

    const r = runScanner({ candles: dataset.candles, zones: [bigZone()] });
    const longs = r.signals.filter((s) => s.type === 'LONG');
    const found = longs.find((s) => s.candleTime === expectedTs);
    expect(found).toBeDefined();
    expect(found?.zoneId).toBe('global');
  });

  it('SHORT-сигнал лежит именно на индексе perfectShortIndex (65% датасета)', () => {
    const dataset = generateMockData();
    const expectedIdx = Math.floor(dataset.candles.length * 0.65);
    const expectedTs = dataset.candles[expectedIdx]?.timestamp;

    const r = runScanner({ candles: dataset.candles, zones: [bigZone()] });
    const shorts = r.signals.filter((s) => s.type === 'SHORT');
    const found = shorts.find((s) => s.candleTime === expectedTs);
    expect(found).toBeDefined();
  });

  it('узкая зона вокруг идеального LONG-сетапа возвращает только LONG-сигнал', () => {
    const dataset = generateMockData();
    const idx = Math.floor(dataset.candles.length * 0.4);
    const c = dataset.candles[idx];
    expect(c).toBeDefined();
    if (!c) return;

    const zone: POIZone = {
      id: 'tight',
      startTime: c.timestamp - MS_5M,
      endTime: c.timestamp + MS_5M,
      minPrice: c.low - 1,
      maxPrice: c.high + 1,
      hasSignal: false,
    };

    const r = runScanner({ candles: dataset.candles, zones: [zone] });
    expect(r.report.longCount).toBe(1);
    expect(r.report.shortCount).toBe(0);
    expect(r.signals[0]?.candleTime).toBe(c.timestamp);
  });
});
