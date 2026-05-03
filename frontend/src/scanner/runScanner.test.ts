import { describe, expect, it } from 'vitest';
import { runScanner } from './runScanner';
import type { Candle5m, POIZone } from '@/types';

function makeLong(t: number, lowPrice = 95, highPrice = 110): Candle5m {
  return {
    timestamp: t,
    open: 100,
    high: highPrice,
    low: lowPrice,
    close: 108,
    volume: 100,
    delta: 30,
    vpoc_price: 100,
    max_vol: 50,
    delta_at_low: -25,
    delta_at_high: 5,
    clusters: [],
  };
}

function makeShort(t: number): Candle5m {
  return {
    timestamp: t,
    open: 110,
    high: 115,
    low: 100,
    close: 102,
    volume: 100,
    delta: -30,
    vpoc_price: 110,
    max_vol: 50,
    delta_at_low: -5,
    delta_at_high: 25,
    clusters: [],
  };
}

function makeNeutral(t: number): Candle5m {
  return {
    timestamp: t,
    open: 100,
    high: 110,
    low: 95,
    close: 100,
    volume: 100,
    delta: 0,
    vpoc_price: 100,
    max_vol: 50,
    delta_at_low: 0,
    delta_at_high: 0,
    clusters: [],
  };
}

describe('runScanner', () => {
  const zone: POIZone = {
    id: 'z1',
    startTime: 0,
    endTime: 10_000,
    minPrice: 90,
    maxPrice: 115,
    hasSignal: false,
  };

  it('пустые данные → пустой результат', () => {
    const r = runScanner({ candles: [], zones: [zone] });
    expect(r.signals).toHaveLength(0);
    expect(r.report.signalsTotal).toBe(0);
    expect(r.report.zonesWithSignal).toBe(0);
    expect(r.zoneIdsWithSignal.size).toBe(0);
  });

  it('нет зон → пустой результат', () => {
    const r = runScanner({ candles: [makeLong(1000)], zones: [] });
    expect(r.signals).toHaveLength(0);
    expect(r.report.zonesTotal).toBe(0);
  });

  it('находит LONG-сигнал в зоне', () => {
    const r = runScanner({
      candles: [makeLong(1000), makeNeutral(2000)],
      zones: [zone],
    });
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]?.type).toBe('LONG');
    expect(r.signals[0]?.candleTime).toBe(1000);
    expect(r.signals[0]?.zoneId).toBe('z1');
    expect(r.signals[0]?.price).toBe(95); // low для LONG
    expect(r.zoneIdsWithSignal.has('z1')).toBe(true);
  });

  it('находит SHORT-сигнал в зоне', () => {
    const r = runScanner({
      candles: [makeShort(1000)],
      zones: [zone],
    });
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]?.type).toBe('SHORT');
    expect(r.signals[0]?.price).toBe(115); // high для SHORT
  });

  it('игнорирует свечи вне временного окна зоны', () => {
    const c = makeLong(20_000); // > zone.endTime
    const r = runScanner({ candles: [c], zones: [zone] });
    expect(r.signals).toHaveLength(0);
    expect(r.zoneIdsWithSignal.size).toBe(0);
  });

  it('игнорирует свечи по цене не пересекающиеся с зоной', () => {
    const c = makeLong(1000, 200, 220); // полностью выше zone.maxPrice=115
    const r = runScanner({ candles: [c], zones: [zone] });
    expect(r.signals).toHaveLength(0);
  });

  it('каждый сигнал получает уникальный id и diagnostics', () => {
    const r = runScanner({
      candles: [makeLong(1000), makeShort(2000)],
      zones: [zone],
    });
    expect(r.signals).toHaveLength(2);
    const [s1, s2] = r.signals;
    expect(s1?.id).toBeDefined();
    expect(s2?.id).toBeDefined();
    expect(s1?.id).not.toBe(s2?.id);
    // diagnostics — числовая копия с корректным mid
    expect(s1?.diagnostics.mid).toBe((110 + 95) / 2);
    expect(s1?.diagnostics.totalDelta).toBe(30);
    expect(s2?.diagnostics.totalDelta).toBe(-30);
  });

  it('корректно считает report при нескольких сигналах и зонах', () => {
    const zoneA: POIZone = { ...zone, id: 'a', startTime: 0, endTime: 5000 };
    const zoneB: POIZone = { ...zone, id: 'b', startTime: 5000, endTime: 10_000 };
    const candles = [
      makeLong(1000), // → a (LONG)
      makeShort(2000), // → a (SHORT)
      makeNeutral(3000),
      makeLong(7000), // → b (LONG)
    ];
    const r = runScanner({ candles, zones: [zoneA, zoneB] });
    expect(r.signals).toHaveLength(3);
    expect(r.report.zonesTotal).toBe(2);
    expect(r.report.zonesWithSignal).toBe(2);
    expect(r.report.signalsTotal).toBe(3);
    expect(r.report.longCount).toBe(2);
    expect(r.report.shortCount).toBe(1);
  });
});
