import { describe, expect, it, vi } from 'vitest';
import {
  FOOTPRINT_MIN_WIDTH_PX,
  computeClusterHitboxes,
  formatClusterVol,
  hitTestCluster,
  renderFootprint,
  shouldRenderFootprint,
} from './footprint';
import type { CanvasMetrics, Viewport } from './scale';
import type { Candle5m } from '@/types';

// ============================================================================
// Заглушка CanvasRenderingContext2D
// ============================================================================

function makeMockCtx(): {
  ctx: CanvasRenderingContext2D;
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };

  const ctx = {
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    measureText: vi.fn().mockReturnValue({ width: 8 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;

  return { ctx, calls };
}

// ============================================================================
// Хелперы для тестовых данных
// ============================================================================

const M: CanvasMetrics = {
  width: 1000,
  height: 600,
  paddingRight: 0,
  paddingBottom: 0,
};

function makeCandle(opts?: Partial<Candle5m>): Candle5m {
  const clusters = [
    { price: 100, bid: 50, ask: 50, vol: 100, delta: 0 },
    { price: 105, bid: 80, ask: 40, vol: 120, delta: -40 }, // SELL imbalance (bid > 2× ask)
    { price: 110, bid: 30, ask: 90, vol: 120, delta: 60 }, // VPOC + BUY imbalance
    { price: 115, bid: 45, ask: 55, vol: 100, delta: 10 },
  ];
  return {
    timestamp: 1_000_000,
    open: 102,
    high: 116,
    low: 99,
    close: 113,
    volume: clusters.reduce((s, c) => s + c.vol, 0),
    delta: clusters.reduce((s, c) => s + c.delta, 0),
    vpoc_price: 110,
    max_vol: 120,
    delta_at_low: 0,
    delta_at_high: 10,
    clusters,
    ...opts,
  };
}

// ============================================================================
// shouldRenderFootprint
// ============================================================================

describe('shouldRenderFootprint', () => {
  it('возвращает false на 1h независимо от ширины', () => {
    const vp: Viewport = {
      timeStart: 0,
      timeEnd: 4 * 60 * 60 * 1000,
      priceMin: 0,
      priceMax: 100,
    };
    expect(shouldRenderFootprint('1h', vp, M)).toBe(false);
  });

  it('возвращает false на 15m при узких свечах', () => {
    const vp: Viewport = {
      timeStart: 0,
      timeEnd: 1000 * 15 * 60 * 1000,
      priceMin: 0,
      priceMax: 100,
    };
    expect(shouldRenderFootprint('15m', vp, M)).toBe(false);
  });

  it('возвращает true на 15m при широких слотах (как у 5m LTF)', () => {
    const vp: Viewport = {
      timeStart: 0,
      timeEnd: 10 * 15 * 60 * 1000,
      priceMin: 0,
      priceMax: 100,
    };
    expect(shouldRenderFootprint('15m', vp, M)).toBe(true);
  });

  it('возвращает false на 5m при узких свечах', () => {
    // 1000 5m свечей в 1000px → 1px каждая
    const vp: Viewport = {
      timeStart: 0,
      timeEnd: 1000 * 5 * 60 * 1000,
      priceMin: 0,
      priceMax: 100,
    };
    expect(shouldRenderFootprint('5m', vp, M)).toBe(false);
  });

  it('возвращает true на 5m при широких свечах', () => {
    // 10 5m свечей в 1000px → 100px каждая, > FOOTPRINT_MIN_WIDTH_PX
    const vp: Viewport = {
      timeStart: 0,
      timeEnd: 10 * 5 * 60 * 1000,
      priceMin: 0,
      priceMax: 100,
    };
    expect(shouldRenderFootprint('5m', vp, M)).toBe(true);
  });

  it('пороговое значение FOOTPRINT_MIN_WIDTH_PX задано и положительно', () => {
    expect(FOOTPRINT_MIN_WIDTH_PX).toBeGreaterThan(0);
  });
});

// ============================================================================
// renderFootprint
// ============================================================================

describe('renderFootprint', () => {
  const vp: Viewport = {
    timeStart: 0,
    timeEnd: 5 * 60 * 1000,
    priceMin: 95,
    priceMax: 120,
  };

  it('не падает на пустых данных', () => {
    const { ctx } = makeMockCtx();
    expect(() =>
      renderFootprint({
        ctx,
        metrics: M,
        viewport: vp,
        candles: [],
        chartTf: '5m',
        startIdx: -1,
        endIdx: -1,
      }),
    ).not.toThrow();
  });

  it('рисует ровно 4 ячейки для свечи с 4 кластерами (по одному strokeRect на ячейку)', () => {
    const { ctx, calls } = makeMockCtx();
    const candle = makeCandle();
    renderFootprint({
      ctx,
      metrics: M,
      viewport: vp,
      candles: [candle],
      chartTf: '5m',
      startIdx: 0,
      endIdx: 0,
    });
    const strokeRects = calls.filter((c) => c.method === 'strokeRect');
    expect(strokeRects).toHaveLength(4);
  });

  it('рисует bid/×/ask текстом с подсветкой имбалансов', () => {
    const { ctx, calls } = makeMockCtx();
    // Свеча содержит явный bid-имбаланс на price=105 (bid=80, ask=40 → 80 > 2×40)
    // и явный ask-имбаланс на price=110 (ask=90 > 2×30).
    const candle = makeCandle();
    // Высокий viewport чтобы каждая ячейка получила достаточную высоту для текста.
    renderFootprint({
      ctx,
      metrics: { ...M, height: 1200 },
      viewport: { timeStart: 0, timeEnd: 5 * 60 * 1000, priceMin: 95, priceMax: 120 },
      candles: [candle],
      chartTf: '5m',
      startIdx: 0,
      endIdx: 0,
    });
    const fillTexts = calls.filter((c) => c.method === 'fillText');
    // На каждую ячейку (4) — по 3 fillText (bid, sep, ask) = 12 минимум
    expect(fillTexts.length).toBeGreaterThanOrEqual(12);
    // Должны быть тексты "80" (bid с имбалансом) и "90" (ask с имбалансом).
    const texts = fillTexts.map((c) => String(c.args[0]));
    expect(texts).toContain('80');
    expect(texts).toContain('90');
  });

  it('делает fallback на классический рендер для свечи без clusters', () => {
    const { ctx, calls } = makeMockCtx();
    const candleNoClusters: Candle5m = {
      timestamp: 0,
      open: 100,
      high: 105,
      low: 99,
      close: 103,
      volume: 100,
      delta: 0,
      vpoc_price: 100,
      max_vol: 0,
      delta_at_low: 0,
      delta_at_high: 0,
      clusters: [],
    };
    renderFootprint({
      ctx,
      metrics: M,
      viewport: vp,
      candles: [candleNoClusters],
      chartTf: '5m',
      startIdx: 0,
      endIdx: 0,
    });
    // классические свечи рисуют тело fillRect — он должен быть вызван
    expect(calls.some((c) => c.method === 'fillRect')).toBe(true);
    // и не должно быть strokeRect (footprint-ячеек нет)
    expect(calls.filter((c) => c.method === 'strokeRect')).toHaveLength(0);
  });

  it('VPOC получает белую жирную рамку (lineWidth 1.5)', () => {
    const { ctx, calls } = makeMockCtx();
    const candle = makeCandle();

    let vpocLineWidthSeen = false;
    let lastLineWidth = 1;

    // Перехватим присвоение lineWidth, чтобы проверять, что в момент strokeRect
    // (последняя установка lineWidth) была 1.5 для VPOC-ячейки и 0.5 для остальных.
    Object.defineProperty(ctx, 'lineWidth', {
      get: () => lastLineWidth,
      set: (v: number) => {
        lastLineWidth = v;
        if (Math.abs(v - 1.5) < 1e-6) vpocLineWidthSeen = true;
      },
      configurable: true,
    });

    renderFootprint({
      ctx,
      metrics: M,
      viewport: vp,
      candles: [candle],
      chartTf: '5m',
      startIdx: 0,
      endIdx: 0,
    });

    // У нас один VPOC (price=110) → должен быть один lineWidth=1.5
    expect(vpocLineWidthSeen).toBe(true);
    expect(calls.some((c) => c.method === 'strokeRect')).toBe(true);
  });
});

// ============================================================================
// computeClusterHitboxes / hitTestCluster
// ============================================================================

describe('computeClusterHitboxes + hitTestCluster', () => {
  const vp: Viewport = {
    timeStart: 0,
    timeEnd: 5 * 60 * 1000,
    priceMin: 95,
    priceMax: 120,
  };
  const M2: CanvasMetrics = { width: 1000, height: 600, paddingRight: 0, paddingBottom: 0 };

  it('строит ровно по одному хитбоксу на кластер (4 кластера → 4)', () => {
    const candle = makeCandle();
    const hb = computeClusterHitboxes([candle], 0, 0, vp, M2, '5m');
    expect(hb).toHaveLength(4);
    // x/w одинаковы у всех (одна свеча), y/h должны различаться (разные уровни)
    const xs = new Set(hb.map((h) => h.x));
    const ys = new Set(hb.map((h) => h.y));
    expect(xs.size).toBe(1);
    expect(ys.size).toBe(4);
    // candleTimestamp проброшен в каждый хитбокс
    for (const h of hb) expect(h.candleTimestamp).toBe(candle.timestamp);
  });

  it('хитбокс ловит точку внутри ячейки', () => {
    const candle = makeCandle();
    const hb = computeClusterHitboxes([candle], 0, 0, vp, M2, '5m');
    const target = hb[1];
    expect(target).toBeDefined();
    if (!target) return;
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    const found = hitTestCluster(hb, cx, cy);
    expect(found).toBe(target);
    expect(found?.cluster.price).toBe(105);
  });

  it('возвращает null для точки вне всех ячеек', () => {
    const candle = makeCandle();
    const hb = computeClusterHitboxes([candle], 0, 0, vp, M2, '5m');
    expect(hitTestCluster(hb, -100, -100)).toBeNull();
    expect(hitTestCluster(hb, 99999, 99999)).toBeNull();
  });

  it('пропускает свечи без полноценных кластеров (как в renderFootprint)', () => {
    const candleNoClusters: Candle5m = {
      timestamp: 0,
      open: 100, high: 105, low: 99, close: 103,
      volume: 100, delta: 0, vpoc_price: 100, max_vol: 0,
      delta_at_low: 0, delta_at_high: 0, clusters: [],
    };
    const hb = computeClusterHitboxes([candleNoClusters], 0, 0, vp, M2, '5m');
    expect(hb).toHaveLength(0);
  });
});

describe('formatClusterVol — адаптивные десятичные знаки', () => {
  it('ноль выводится как "0", без десятичных', () => {
    expect(formatClusterVol(0)).toBe('0');
  });

  it('значения < 1 — две десятичные', () => {
    expect(formatClusterVol(0.05)).toBe('0.05');
    expect(formatClusterVol(0.42)).toBe('0.42');
    expect(formatClusterVol(0.99)).toBe('0.99');
  });

  it('значения [1, 10) — одна десятичная', () => {
    expect(formatClusterVol(1)).toBe('1.0');
    expect(formatClusterVol(3.456)).toBe('3.5');
    expect(formatClusterVol(9.94)).toBe('9.9');
  });

  it('значения [10, 1000) — целое число', () => {
    expect(formatClusterVol(10)).toBe('10');
    expect(formatClusterVol(127.8)).toBe('128');
    expect(formatClusterVol(999.4)).toBe('999');
  });

  it('значения ≥ 1000 — компактный формат с "k"', () => {
    expect(formatClusterVol(1000)).toBe('1.0k');
    expect(formatClusterVol(1234)).toBe('1.2k');
    expect(formatClusterVol(99000)).toBe('99.0k');
  });

  it('гарантирует, что 0.5 НЕ становится "0" — главная регрессия', () => {
    // До 1.11.2 здесь делался Math.round, и 0.5 округлялось до 0 (или 1, в зависимости от banker's),
    // что делало кластеры неинформативными на BTCUSDT при tick_size=5.
    expect(formatClusterVol(0.5)).toBe('0.50');
  });

  it('некорректный вход (NaN/Infinity) выводится как "0"', () => {
    expect(formatClusterVol(NaN)).toBe('0');
    expect(formatClusterVol(Infinity)).toBe('0');
  });
});
