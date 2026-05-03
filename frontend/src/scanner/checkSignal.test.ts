import { describe, expect, it } from 'vitest';
import {
  buildDiagnostics,
  candleInZone,
  checkSignal,
  countImbalances,
  detectZeroAtExtreme,
} from './checkSignal';
import type { Candle5m, POIZone } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/** «Идеальный» LONG-кандидат: все 4 правила выполнены. */
function makeLongCandle(overrides: Partial<Candle5m> = {}): Candle5m {
  return {
    timestamp: 1_000_000,
    open: 100,
    high: 110,
    low: 95,
    close: 108, // > mid (102.5) ✓
    volume: 100,
    delta: 30, // > 0 ✓
    vpoc_price: 100, // close (108) > 100 ✓
    max_vol: 50,
    delta_at_low: -25, // < 0 ✓ — поглощение покупателями
    delta_at_high: 5,
    clusters: [],
    ...overrides,
  };
}

/** «Идеальный» SHORT-кандидат: все 4 зеркальных правила выполнены. */
function makeShortCandle(overrides: Partial<Candle5m> = {}): Candle5m {
  return {
    timestamp: 1_000_000,
    open: 110,
    high: 115,
    low: 100,
    close: 102, // < mid (107.5) ✓
    volume: 100,
    delta: -30, // < 0 ✓
    vpoc_price: 110, // close (102) < 110 ✓
    max_vol: 50,
    delta_at_low: -5,
    delta_at_high: 25, // > 0 ✓ — поглощение продавцами
    clusters: [],
    ...overrides,
  };
}

// ============================================================================
// LONG positives + negatives
// ============================================================================

describe('checkSignal · LONG', () => {
  it('возвращает LONG для свечи со всеми 4 правилами', () => {
    const c = makeLongCandle();
    const r = checkSignal(c);
    expect(r.type).toBe('LONG');
    expect(r.longRules).toEqual({
      polarity: true,
      totalDelta: true,
      closeVsVpoc: true,
      absorption: true,
    });
  });

  it('null если поляризация не прошла (close в нижней половине)', () => {
    const c = makeLongCandle({ close: 100 }); // mid = 102.5; close < mid → fail R1
    const r = checkSignal(c);
    expect(r.type).toBeNull();
    expect(r.longRules.polarity).toBe(false);
  });

  it('null если total delta отрицательная', () => {
    const c = makeLongCandle({ delta: -1 });
    const r = checkSignal(c);
    expect(r.type).toBeNull();
    expect(r.longRules.totalDelta).toBe(false);
  });

  it('null если close ниже VPOC', () => {
    const c = makeLongCandle({ vpoc_price: 109 }); // close (108) < 109 → fail R3
    const r = checkSignal(c);
    expect(r.type).toBeNull();
    expect(r.longRules.closeVsVpoc).toBe(false);
  });

  it('null если на low не было поглощения (delta_at_low >= 0)', () => {
    const c = makeLongCandle({ delta_at_low: 0 });
    const r = checkSignal(c);
    expect(r.type).toBeNull();
    expect(r.longRules.absorption).toBe(false);
  });
});

// ============================================================================
// SHORT positives + negatives
// ============================================================================

describe('checkSignal · SHORT', () => {
  it('возвращает SHORT для свечи со всеми 4 зеркальными правилами', () => {
    const c = makeShortCandle();
    const r = checkSignal(c);
    expect(r.type).toBe('SHORT');
    expect(r.shortRules).toEqual({
      polarity: true,
      totalDelta: true,
      closeVsVpoc: true,
      absorption: true,
    });
  });

  it('null если поляризация не прошла (close в верхней половине)', () => {
    const c = makeShortCandle({ close: 113 }); // mid=107.5; close > mid → fail
    const r = checkSignal(c);
    expect(r.type).toBeNull();
  });

  it('null если total delta положительная', () => {
    const c = makeShortCandle({ delta: 1 });
    const r = checkSignal(c);
    expect(r.type).toBeNull();
  });

  it('null если на high не было поглощения (delta_at_high <= 0)', () => {
    const c = makeShortCandle({ delta_at_high: 0 });
    const r = checkSignal(c);
    expect(r.type).toBeNull();
  });
});

// ============================================================================
// candleInZone
// ============================================================================

describe('candleInZone', () => {
  const zone: POIZone = {
    id: 'z1',
    startTime: 1000,
    endTime: 2000,
    minPrice: 100,
    maxPrice: 110,
    hasSignal: false,
  };

  function makeC(t: number, low: number, high: number): Candle5m {
    return makeLongCandle({ timestamp: t, low, high });
  }

  it('true для свечи строго внутри зоны', () => {
    expect(candleInZone(makeC(1500, 102, 108), zone)).toBe(true);
  });

  it('false для свечи раньше зоны по времени', () => {
    expect(candleInZone(makeC(999, 102, 108), zone)).toBe(false);
  });

  it('false для свечи позже зоны по времени', () => {
    expect(candleInZone(makeC(2001, 102, 108), zone)).toBe(false);
  });

  it('false для свечи полностью выше зоны по цене', () => {
    expect(candleInZone(makeC(1500, 120, 130), zone)).toBe(false);
  });

  it('false для свечи полностью ниже зоны по цене', () => {
    expect(candleInZone(makeC(1500, 80, 90), zone)).toBe(false);
  });

  it('true для свечи частично перекрывающей зону снизу', () => {
    expect(candleInZone(makeC(1500, 80, 105), zone)).toBe(true);
  });

  it('true для свечи частично перекрывающей зону сверху', () => {
    expect(candleInZone(makeC(1500, 105, 130), zone)).toBe(true);
  });
});

// ============================================================================
// buildDiagnostics — численные значения для UI
// ============================================================================

describe('buildDiagnostics', () => {
  it('копирует OHLC, delta, vpoc и delta_at_*; считает mid корректно', () => {
    const c = makeLongCandle();
    const d = buildDiagnostics(c, 'LONG');
    expect(d.open).toBe(c.open);
    expect(d.high).toBe(c.high);
    expect(d.low).toBe(c.low);
    expect(d.close).toBe(c.close);
    expect(d.totalDelta).toBe(c.delta);
    expect(d.vpoc_price).toBe(c.vpoc_price);
    expect(d.delta_at_low).toBe(c.delta_at_low);
    expect(d.delta_at_high).toBe(c.delta_at_high);
    expect(d.mid).toBe((c.high + c.low) / 2);
  });

  it('vol_at_low / vol_at_high возвращает 0 при пустом clusters', () => {
    const c = makeLongCandle({ clusters: [] });
    const d = buildDiagnostics(c, 'LONG');
    expect(d.vol_at_low).toBe(0);
    expect(d.vol_at_high).toBe(0);
  });

  it('vol_at_low / vol_at_high находит ближайший кластер по цене', () => {
    const c = makeLongCandle({
      low: 95,
      high: 110,
      clusters: [
        { price: 95, bid: 30, ask: 5, vol: 35, delta: -25 },
        { price: 100, bid: 10, ask: 20, vol: 30, delta: 10 },
        { price: 110, bid: 5, ask: 15, vol: 20, delta: 10 },
      ],
    });
    const d = buildDiagnostics(c, 'LONG');
    expect(d.vol_at_low).toBe(35);
    expect(d.vol_at_high).toBe(20);
  });

  it('включает бонус-индикаторы (imbalanceCount + hasZeroAtExtreme)', () => {
    const c = makeLongCandle({
      low: 95,
      high: 110,
      clusters: [
        // low — нет агрессивных покупок (ask=0) → hasZeroAtExtreme для LONG
        { price: 95, bid: 30, ask: 0, vol: 30, delta: -30 },
        // bullish-имбаланс: ask >> bid
        { price: 100, bid: 5, ask: 25, vol: 30, delta: 20 },
        // bearish-имбаланс: bid >> ask (НЕ считается для LONG)
        { price: 110, bid: 20, ask: 5, vol: 25, delta: -15 },
      ],
    });
    const d = buildDiagnostics(c, 'LONG');
    expect(d.imbalanceCount).toBe(1); // только bullish-имбаланс
    expect(d.imbalancePrices).toEqual([100]);
    expect(d.hasZeroAtExtreme).toBe(true);
  });
});

// ============================================================================
// Бонус-индикаторы (необязательные условия) — countImbalances / detectZeroAtExtreme
// ============================================================================

describe('countImbalances', () => {
  it('LONG считает только бычьи имбалансы (ask ≥ 2 × bid И bid > 0)', () => {
    const clusters = [
      { price: 100, bid: 5, ask: 15, vol: 20, delta: 10 }, // ask/bid=3 → ✓
      { price: 105, bid: 10, ask: 10, vol: 20, delta: 0 }, // паритет → ✗
      { price: 110, bid: 20, ask: 5, vol: 25, delta: -15 }, // bearish → ✗ для LONG
      { price: 115, bid: 1, ask: 4, vol: 5, delta: 3 }, // ask/bid=4 → ✓
    ];
    const r = countImbalances(clusters, 'LONG');
    expect(r.count).toBe(2);
    expect(r.prices).toEqual([100, 115]);
  });

  it('SHORT считает только медвежьи имбалансы (bid ≥ 2 × ask И ask > 0)', () => {
    const clusters = [
      { price: 100, bid: 15, ask: 5, vol: 20, delta: -10 }, // bid/ask=3 → ✓
      { price: 105, bid: 5, ask: 15, vol: 20, delta: 10 }, // bullish → ✗ для SHORT
      { price: 110, bid: 20, ask: 4, vol: 24, delta: -16 }, // bid/ask=5 → ✓
    ];
    const r = countImbalances(clusters, 'SHORT');
    expect(r.count).toBe(2);
    expect(r.prices).toEqual([100, 110]);
  });

  it('не считает имбалансом ячейку с нулевой противоположной стороной', () => {
    // bid=0 + ask=10 — это «нуль» (auction exhaustion), не имбаланс.
    // Считать дублирующим бонусом не хочется → countImbalances должна вернуть 0.
    const r = countImbalances(
      [{ price: 100, bid: 0, ask: 10, vol: 10, delta: 10 }],
      'LONG',
    );
    expect(r.count).toBe(0);
    expect(r.prices).toEqual([]);
  });

  it('возвращает 0 для пустого массива кластеров', () => {
    expect(countImbalances([], 'LONG')).toEqual({ count: 0, prices: [] });
    expect(countImbalances([], 'SHORT')).toEqual({ count: 0, prices: [] });
  });
});

describe('detectZeroAtExtreme', () => {
  it('LONG: возвращает true, когда ask=0 на самом нижнем кластере', () => {
    const clusters = [
      { price: 100, bid: 5, ask: 0, vol: 5, delta: -5 },
      { price: 105, bid: 10, ask: 10, vol: 20, delta: 0 },
    ];
    expect(detectZeroAtExtreme(clusters, 'LONG')).toBe(true);
  });

  it('LONG: возвращает false, если ask>0 на низу, даже если есть нули на других уровнях', () => {
    const clusters = [
      { price: 100, bid: 5, ask: 1, vol: 6, delta: -4 }, // не нуль
      { price: 105, bid: 10, ask: 0, vol: 10, delta: -10 }, // нуль, но не на low
    ];
    expect(detectZeroAtExtreme(clusters, 'LONG')).toBe(false);
  });

  it('SHORT: возвращает true, когда bid=0 на самом верхнем кластере', () => {
    const clusters = [
      { price: 100, bid: 5, ask: 10, vol: 15, delta: 5 },
      { price: 105, bid: 0, ask: 8, vol: 8, delta: 8 },
    ];
    expect(detectZeroAtExtreme(clusters, 'SHORT')).toBe(true);
  });

  it('возвращает false для пустого массива кластеров', () => {
    expect(detectZeroAtExtreme([], 'LONG')).toBe(false);
    expect(detectZeroAtExtreme([], 'SHORT')).toBe(false);
  });
});
