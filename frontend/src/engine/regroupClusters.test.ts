import { describe, expect, it } from 'vitest';
import {
  computeAutoMultiplier,
  detectBaseTickSize,
  regroupCandle,
  regroupCandles,
  type TickMultiplier,
} from './regroupClusters';
import type { Candle5m, Cluster } from '@/types';

// ============================================================================
// Хелперы
// ============================================================================

function makeCluster(price: number, bid: number, ask: number): Cluster {
  return { price, bid, ask, vol: bid + ask, delta: ask - bid };
}

/**
 * Кандла с заданными кластерами + автозаполнение agg-полей.
 * Используется как «сырой» вход в regroupCandle, чтобы не дублировать
 * вычисление vpoc/max_vol в каждом тесте.
 */
function makeCandle(
  clusters: Cluster[],
  overrides: Partial<Candle5m> = {},
): Candle5m {
  const sorted = [...clusters].sort((a, b) => a.price - b.price);
  const volume = sorted.reduce((s, c) => s + c.vol, 0);
  const delta = sorted.reduce((s, c) => s + c.delta, 0);
  let vpoc = sorted[0]!.price;
  let maxVol = sorted[0]!.vol;
  for (const c of sorted) {
    if (c.vol > maxVol) {
      maxVol = c.vol;
      vpoc = c.price;
    }
  }
  return {
    timestamp: 1_000_000,
    open: sorted[0]!.price + 1,
    high: sorted[sorted.length - 1]!.price + 1,
    low: sorted[0]!.price,
    close: sorted[sorted.length - 1]!.price,
    volume,
    delta,
    vpoc_price: vpoc,
    max_vol: maxVol,
    delta_at_low: sorted[0]!.delta,
    delta_at_high: sorted[sorted.length - 1]!.delta,
    clusters: sorted,
    ...overrides,
  };
}

// ============================================================================
// detectBaseTickSize
// ============================================================================

describe('detectBaseTickSize', () => {
  it('возвращает 0 для < 2 кластеров (определить нечем)', () => {
    expect(detectBaseTickSize([])).toBe(0);
    expect(detectBaseTickSize([makeCluster(100, 1, 1)])).toBe(0);
  });

  it('берёт минимум положительной разности (исключая дыры)', () => {
    // base tick = 5; одна дыра между 105 и 115 (отсутствует 110).
    // Минимум разности должен быть 5, а не 10.
    const cs = [
      makeCluster(100, 1, 1),
      makeCluster(105, 1, 1),
      makeCluster(115, 1, 1),
      makeCluster(120, 1, 1),
    ];
    expect(detectBaseTickSize(cs)).toBe(5);
  });

  it('работает для дробного tick (SOL: 0.05)', () => {
    const cs = [
      makeCluster(145.0, 1, 1),
      makeCluster(145.05, 1, 1),
      makeCluster(145.1, 1, 1),
    ];
    expect(detectBaseTickSize(cs)).toBeCloseTo(0.05, 8);
  });
});

// ============================================================================
// regroupCandle: no-op случаи
// ============================================================================

describe('regroupCandle (no-op)', () => {
  it('multiplier=1 возвращает ТОТ ЖЕ объект (referential equality)', () => {
    const candle = makeCandle([
      makeCluster(100, 10, 10),
      makeCluster(105, 5, 15),
    ]);
    expect(regroupCandle(candle, 1)).toBe(candle);
  });

  it('< 2 кластеров — без изменений (нечего группировать)', () => {
    const candle = makeCandle([makeCluster(100, 10, 10)]);
    const result = regroupCandle(candle, 5);
    expect(result.clusters).toEqual(candle.clusters);
    expect(result.vpoc_price).toBe(candle.vpoc_price);
  });

  it('пустые кластеры — без изменений', () => {
    const candle = makeCandle(
      [makeCluster(100, 1, 1)], // достаточно для makeCandle
      { clusters: [] },
    );
    const result = regroupCandle(candle, 5);
    expect(result.clusters).toEqual([]);
  });
});

// ============================================================================
// regroupCandle: базовая группировка
// ============================================================================

describe('regroupCandle (mul=2, base tick=5)', () => {
  it('объединяет 4 ячейки в 2, корректно суммируя bid/ask/vol/delta', () => {
    const candle = makeCandle(
      [
        makeCluster(100, 10, 20), // в группу 100 (idx 0/2 → 0)
        makeCluster(105, 5, 15), // в группу 100 (idx 1/2 → 0)
        makeCluster(110, 30, 40), // в группу 110 (idx 2/2 → 1)
        makeCluster(115, 25, 35), // в группу 110 (idx 3/2 → 1)
      ],
      { low: 100, high: 115 },
    );

    const result = regroupCandle(candle, 2);
    expect(result.clusters).toHaveLength(2);

    const [low, high] = result.clusters;
    expect(low).toBeDefined();
    expect(high).toBeDefined();

    // Группа 100: bid=10+5=15, ask=20+15=35, vol=30+20=50, delta=10+10=20
    expect(low!.price).toBe(100);
    expect(low!.bid).toBe(15);
    expect(low!.ask).toBe(35);
    expect(low!.vol).toBe(50);
    expect(low!.delta).toBe(20);

    // Группа 110: bid=30+25=55, ask=40+35=75, vol=70+60=130, delta=10+10=20
    expect(high!.price).toBe(110);
    expect(high!.bid).toBe(55);
    expect(high!.ask).toBe(75);
    expect(high!.vol).toBe(130);
    expect(high!.delta).toBe(20);
  });

  it('кластеры остаются отсортированы по возрастанию price', () => {
    const candle = makeCandle([
      makeCluster(100, 1, 1),
      makeCluster(105, 1, 1),
      makeCluster(110, 1, 1),
      makeCluster(115, 1, 1),
      makeCluster(120, 1, 1),
    ]);
    const result = regroupCandle(candle, 2);
    for (let i = 1; i < result.clusters.length; i++) {
      expect(result.clusters[i]!.price).toBeGreaterThan(
        result.clusters[i - 1]!.price,
      );
    }
  });

  it('сохраняет инвариант vol = bid + ask для всех новых кластеров', () => {
    const candle = makeCandle([
      makeCluster(100, 7, 13),
      makeCluster(105, 3, 17),
      makeCluster(110, 11, 9),
      makeCluster(115, 8, 12),
    ]);
    const result = regroupCandle(candle, 2);
    for (const c of result.clusters) {
      expect(c.vol).toBe(c.bid + c.ask);
      expect(c.delta).toBe(c.ask - c.bid);
    }
  });

  it('сумма vol/delta после регруппировки == исходной (закон сохранения)', () => {
    const candle = makeCandle([
      makeCluster(100, 7, 13),
      makeCluster(105, 3, 17),
      makeCluster(110, 11, 9),
      makeCluster(115, 8, 12),
      makeCluster(120, 4, 6),
    ]);
    const totalVolBefore = candle.clusters.reduce((s, c) => s + c.vol, 0);
    const totalDeltaBefore = candle.clusters.reduce((s, c) => s + c.delta, 0);

    const result = regroupCandle(candle, 5);
    const totalVolAfter = result.clusters.reduce((s, c) => s + c.vol, 0);
    const totalDeltaAfter = result.clusters.reduce((s, c) => s + c.delta, 0);

    expect(totalVolAfter).toBe(totalVolBefore);
    expect(totalDeltaAfter).toBe(totalDeltaBefore);
  });
});

// ============================================================================
// regroupCandle: пересчёт VPOC и max_vol на новой сетке
// ============================================================================

describe('regroupCandle: пересчёт vpoc_price и max_vol', () => {
  it('VPOC сдвигается, если объединение создаёт новый максимум', () => {
    // Исходный VPOC — на 110 (vol=120).
    // После объединения mul=2: группа 100 = 100 + 105 = 60+60 = 120,
    //                         группа 110 = 110 + 115 = 120+30 = 150.
    // Новый VPOC должен встать на 110 с max_vol=150.
    const candle = makeCandle([
      makeCluster(100, 30, 30), // vol=60
      makeCluster(105, 30, 30), // vol=60
      makeCluster(110, 60, 60), // vol=120 (исходный VPOC)
      makeCluster(115, 15, 15), // vol=30
    ]);
    const result = regroupCandle(candle, 2);
    expect(result.vpoc_price).toBe(110);
    expect(result.max_vol).toBe(150);
  });

  it('VPOC может СМЕНИТЬ ценовой уровень после регруппировки', () => {
    // Исходный VPOC на 115 (vol=200).
    // После mul=2: группа 100 (100+105) = 50+150 = 200 ← такой же максимум,
    //              группа 110 (110+115) = 30+200 = 230 ← новый максимум.
    const candle = makeCandle([
      makeCluster(100, 25, 25), // vol=50
      makeCluster(105, 75, 75), // vol=150
      makeCluster(110, 15, 15), // vol=30
      makeCluster(115, 100, 100), // vol=200 (исходный VPOC)
    ]);
    const result = regroupCandle(candle, 2);
    expect(result.vpoc_price).toBe(110);
    expect(result.max_vol).toBe(230);
  });
});

// ============================================================================
// regroupCandle: пересчёт delta_at_low / delta_at_high
// ============================================================================

describe('regroupCandle: пересчёт delta_at_low/high', () => {
  it('delta_at_low — это дельта группы, в которую попал candle.low', () => {
    // low=100 → group_idx = floor(20/2) = 10 → group 100.
    // group 100 = 100(delta=10) + 105(delta=-30) = -20.
    const candle = makeCandle(
      [
        makeCluster(100, 5, 15), // delta = 10
        makeCluster(105, 40, 10), // delta = -30
        makeCluster(110, 20, 20),
        makeCluster(115, 10, 30),
      ],
      { low: 100, high: 115 },
    );
    const result = regroupCandle(candle, 2);
    expect(result.delta_at_low).toBe(-20);
  });

  it('delta_at_high — это дельта группы, в которую попал candle.high', () => {
    // high=115 → group_idx = floor(23/2) = 11 → group 110.
    // group 110 = 110(delta=0) + 115(delta=20) = 20.
    const candle = makeCandle(
      [
        makeCluster(100, 5, 15),
        makeCluster(105, 40, 10),
        makeCluster(110, 20, 20), // delta = 0
        makeCluster(115, 10, 30), // delta = 20
      ],
      { low: 100, high: 115 },
    );
    const result = regroupCandle(candle, 2);
    expect(result.delta_at_high).toBe(20);
  });

  it('возвращает 0, если в новой сетке нет бакета на low/high (теоретически)', () => {
    // Защитный сценарий: low ниже самого низкого кластера.
    const candle = makeCandle(
      [makeCluster(100, 5, 15), makeCluster(105, 5, 15)],
      { low: 50 },
    );
    const result = regroupCandle(candle, 2);
    expect(result.delta_at_low).toBe(0);
  });
});

// ============================================================================
// regroupCandle: дробные tick_size (SOL=0.05, ETH=0.5)
// ============================================================================

describe('regroupCandle: дробные tick_size', () => {
  it('SOL: tick=0.05, mul=5 → корректно группирует без drift\'а', () => {
    const candle = makeCandle([
      makeCluster(145.0, 10, 10),
      makeCluster(145.05, 10, 10),
      makeCluster(145.1, 10, 10),
      makeCluster(145.15, 10, 10),
      makeCluster(145.2, 10, 10),
      makeCluster(145.25, 10, 10),
    ]);
    const result = regroupCandle(candle, 5);
    // group_idx = floor(round(price/0.05) / 5):
    //   145.00 → floor(2900/5) = 580 → price = 580 * 5 * 0.05 = 145.0
    //   145.05 → floor(2901/5) = 580 → 145.0
    //   145.10 → floor(2902/5) = 580 → 145.0
    //   145.15 → floor(2903/5) = 580 → 145.0
    //   145.20 → floor(2904/5) = 580 → 145.0
    //   145.25 → floor(2905/5) = 581 → 145.25
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]!.price).toBeCloseTo(145.0, 8);
    expect(result.clusters[1]!.price).toBeCloseTo(145.25, 8);
    expect(result.clusters[0]!.vol).toBe(100); // 5 кластеров × 20
    expect(result.clusters[1]!.vol).toBe(20); // 1 кластер × 20
  });

  it('ETH: tick=0.5, mul=2 → корректные ценовые границы', () => {
    const candle = makeCandle([
      makeCluster(2500.0, 5, 5),
      makeCluster(2500.5, 5, 5),
      makeCluster(2501.0, 5, 5),
      makeCluster(2501.5, 5, 5),
    ]);
    const result = regroupCandle(candle, 2);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]!.price).toBeCloseTo(2500.0, 8);
    expect(result.clusters[1]!.price).toBeCloseTo(2501.0, 8);
  });
});

// ============================================================================
// regroupCandle: дыры (missing levels)
// ============================================================================

describe('regroupCandle: пропуски уровней', () => {
  it('кластеры с дырами группируются корректно (без фантомных нулевых)', () => {
    // Исходные кластеры с дырой на 105 и 115 (рынок не торговал на этих уровнях).
    // base tick = 5 (минимальная разность 105-100=5 не существует, минимум 110-100=10? Нет —
    // минимум 5 будет на 110-105... но 105 нет. Тогда минимум 10. Поэтому возьмём другую раскладку.)
    const candle = makeCandle([
      makeCluster(100, 5, 5),
      makeCluster(105, 5, 5),
      makeCluster(115, 5, 5), // дыра на 110
    ]);
    const result = regroupCandle(candle, 2);
    // group 100 = 100+105 (bid+ask=20)
    // group 110 = 115 (нет 110, только 115; bid+ask=10)
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]!.price).toBe(100);
    expect(result.clusters[0]!.vol).toBe(20);
    expect(result.clusters[1]!.price).toBe(110);
    expect(result.clusters[1]!.vol).toBe(10);
  });
});

// ============================================================================
// regroupCandles (множественный вход)
// ============================================================================

describe('regroupCandles', () => {
  it('multiplier=1 возвращает ТОТ ЖЕ массив (referential equality)', () => {
    const candles = [
      makeCandle([makeCluster(100, 1, 1), makeCluster(105, 1, 1)]),
      makeCandle([makeCluster(200, 1, 1), makeCluster(205, 1, 1)]),
    ];
    expect(regroupCandles(candles, 1)).toBe(candles);
  });

  it('создаёт новый массив для multiplier > 1, но не мутирует входной', () => {
    const candles = [
      makeCandle([
        makeCluster(100, 1, 1),
        makeCluster(105, 1, 1),
        makeCluster(110, 1, 1),
        makeCluster(115, 1, 1),
      ]),
    ];
    const original = candles[0]!.clusters.length;
    const result = regroupCandles(candles, 2);

    expect(result).not.toBe(candles);
    expect(candles[0]!.clusters.length).toBe(original); // не мутировали
    expect(result[0]!.clusters.length).toBe(2);
  });
});

// ============================================================================
// computeAutoMultiplier
// ============================================================================

describe('computeAutoMultiplier', () => {
  it('пустой датасет → ×1', () => {
    expect(computeAutoMultiplier([])).toBe(1);
  });

  function makeCandlesWithDensity(
    avgClustersPerCandle: number,
    n = 20,
  ): Candle5m[] {
    return Array.from({ length: n }, () => {
      const cs: Cluster[] = [];
      for (let i = 0; i < avgClustersPerCandle; i++) {
        cs.push(makeCluster(100 + i * 5, 1, 1));
      }
      return makeCandle(cs);
    });
  }

  const cases: [number, TickMultiplier][] = [
    [10, 1],
    [25, 1], // граница
    [40, 2],
    [60, 2], // граница
    [100, 5],
    [150, 5], // граница
    [200, 10],
  ];

  it.each(cases)('avg=%d → ×%d', (avg, expected) => {
    const candles = makeCandlesWithDensity(avg);
    expect(computeAutoMultiplier(candles)).toBe(expected);
  });

  it('игнорирует свечи с < 2 кластерами (Binance-fallback)', () => {
    // 5 жирных свечей по 50 кластеров + 95 пустых → если бы пустые учитывались,
    // среднее упало бы до ~2.5 и автоматический выбор стал бы ×1.
    // Игнорируя пустые, среднее остаётся 50 → ×2.
    const dense = makeCandlesWithDensity(50, 5);
    const sparse: Candle5m[] = Array.from({ length: 95 }, () =>
      makeCandle([makeCluster(100, 1, 1)]),
    );
    expect(computeAutoMultiplier([...dense, ...sparse])).toBe(2);
  });
});
