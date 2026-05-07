/**
 * Юнит-тесты для liveCandleBuilder — чистые функции, никаких моков.
 *
 * Покрываем все ключевые инварианты, которые потом проверяет сканер
 * (vpoc_price, delta_at_low/high) и SMC-детекторы (sort кластеров).
 */

import { describe, expect, it } from 'vitest';
import {
  FIVE_MIN_MS,
  applyTickToCandle,
  bucketPrice,
  bucketTimestamp5m,
  finalizeCandle,
  openNewCandle,
} from './liveCandleBuilder';
import type { AggTradeTick } from '@/types';

const T0 = 1762560000000; // 2025-11-07 20:00:00 UTC, выровнен на 5m

function tick(
  i: number,
  price: number,
  qty: number,
  isBuyerMaker: boolean,
  ts: number = T0 + i * 1000,
): AggTradeTick {
  return { aggTradeId: i, price, qty, isBuyerMaker, timestamp: ts };
}

describe('bucketPrice', () => {
  it('целочисленный tick: floor к ближайшей сетке снизу', () => {
    expect(bucketPrice(65437.5, 5)).toBe(65435);
    expect(bucketPrice(65430, 5)).toBe(65430); // на самой границе
    expect(bucketPrice(65439.99, 5)).toBe(65435);
  });

  it('дробный tick: 0.05 — без drift\'а floating-point', () => {
    expect(bucketPrice(150.07, 0.05)).toBe(150.05);
    expect(bucketPrice(150.05, 0.05)).toBe(150.05);
    expect(bucketPrice(150.04, 0.05)).toBe(150);
  });

  it('очень мелкий tick: 0.001 — корректное поведение', () => {
    expect(bucketPrice(2.3456, 0.001)).toBe(2.345);
    expect(bucketPrice(2.345, 0.001)).toBe(2.345);
  });

  it('tick=0 или отрицательный: возвращаем без изменений', () => {
    expect(bucketPrice(123.45, 0)).toBe(123.45);
    expect(bucketPrice(123.45, -1)).toBe(123.45);
  });
});

describe('bucketTimestamp5m', () => {
  it('округляет вниз до 5-минутной сетки UTC', () => {
    const slot = T0; // выровнен
    expect(bucketTimestamp5m(slot)).toBe(slot);
    expect(bucketTimestamp5m(slot + 30_000)).toBe(slot); // +30 сек
    expect(bucketTimestamp5m(slot + FIVE_MIN_MS - 1)).toBe(slot); // последняя ms
    expect(bucketTimestamp5m(slot + FIVE_MIN_MS)).toBe(slot + FIVE_MIN_MS);
  });
});

describe('openNewCandle', () => {
  it('создаёт пустую свечу, выровненную на слот', () => {
    const c = openNewCandle(T0 + 123_456); // середина слота
    expect(c.timestamp).toBe(T0);
    expect(c.clusters).toHaveLength(0);
    expect(c.volume).toBe(0);
    expect(c.delta).toBe(0);
    expect(c.high).toBe(0);
  });
});

describe('applyTickToCandle', () => {
  it('первый тик: open=high=low=close=price, кластер с +ask', () => {
    const c0 = openNewCandle(T0);
    const c1 = applyTickToCandle(c0, tick(1, 65430, 0.5, false), 5);
    expect(c1.open).toBe(65430);
    expect(c1.high).toBe(65430);
    expect(c1.low).toBe(65430);
    expect(c1.close).toBe(65430);
    expect(c1.volume).toBe(0.5);
    expect(c1.delta).toBe(0.5); // isBuyerMaker=false → ask, delta = qty
    expect(c1.clusters).toHaveLength(1);
    expect(c1.clusters[0]).toMatchObject({
      price: 65430,
      bid: 0,
      ask: 0.5,
      vol: 0.5,
      delta: 0.5,
    });
  });

  it('второй тик в тот же кластер: bid накапливается', () => {
    const c0 = openNewCandle(T0);
    const c1 = applyTickToCandle(c0, tick(1, 65430, 1.0, false), 5); // +ask
    const c2 = applyTickToCandle(c1, tick(2, 65431, 0.4, true), 5); // +bid (тот же бакет)
    expect(c2.clusters).toHaveLength(1);
    expect(c2.clusters[0]).toMatchObject({
      price: 65430,
      bid: 0.4,
      ask: 1.0,
      vol: 1.4,
      delta: 0.6,
    });
    expect(c2.volume).toBeCloseTo(1.4, 9);
    expect(c2.delta).toBeCloseTo(0.6, 9);
    expect(c2.high).toBe(65431);
    expect(c2.low).toBe(65430);
  });

  it('три кластера: вставка с сохранением sort\'а по price ↑', () => {
    let c = openNewCandle(T0);
    c = applyTickToCandle(c, tick(1, 65440, 1, false), 5); // [65440]
    c = applyTickToCandle(c, tick(2, 65430, 1, false), 5); // [65430, 65440]
    c = applyTickToCandle(c, tick(3, 65435, 1, false), 5); // [65430, 65435, 65440]
    const prices = c.clusters.map((cl) => cl.price);
    expect(prices).toEqual([65430, 65435, 65440]);
  });

  it('VPOC = кластер с максимальным объёмом', () => {
    let c = openNewCandle(T0);
    c = applyTickToCandle(c, tick(1, 65430, 1, false), 5);
    c = applyTickToCandle(c, tick(2, 65435, 5, true), 5); // самый объёмный
    c = applyTickToCandle(c, tick(3, 65440, 2, false), 5);
    expect(c.vpoc_price).toBe(65435);
    expect(c.max_vol).toBe(5);
  });

  it('delta_at_low/high берутся с краёв sorted-массива кластеров', () => {
    let c = openNewCandle(T0);
    c = applyTickToCandle(c, tick(1, 65440, 2, false), 5); // ask, +2 → high
    c = applyTickToCandle(c, tick(2, 65430, 3, true), 5); // bid, -3 → low
    expect(c.clusters[0]?.price).toBe(65430);
    expect(c.delta_at_low).toBe(-3);
    expect(c.delta_at_high).toBe(2);
  });

  it('isBuyerMaker=true → bid; false → ask', () => {
    let c = openNewCandle(T0);
    c = applyTickToCandle(c, tick(1, 100, 1, true), 1); // bid +1
    c = applyTickToCandle(c, tick(2, 100, 2, false), 1); // ask +2
    expect(c.clusters[0]).toMatchObject({ bid: 1, ask: 2, delta: 1 });
  });
});

describe('finalizeCandle', () => {
  it('пустая свеча: возвращается как есть', () => {
    const c = openNewCandle(T0);
    expect(finalizeCandle(c)).toBe(c);
  });

  it('свеча с тиками: финализация не ломает агрегаты', () => {
    let c = openNewCandle(T0);
    c = applyTickToCandle(c, tick(1, 100, 1, false), 1);
    const final = finalizeCandle(c);
    expect(final.volume).toBe(1);
    expect(final.clusters).toHaveLength(1);
  });
});
