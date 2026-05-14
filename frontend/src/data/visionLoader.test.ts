/**
 * Юнит-тесты для `aggregateCsvToCandles`:
 *   - happy path: ms-timestamps корректно группируются в 5m-окна
 *   - регрессия: μs-timestamps от Binance Vision нормализуются (баг 1.37.3)
 */

import { describe, it, expect } from 'vitest';
import { aggregateCsvToCandles } from './visionLoader';

/** Формат строки CSV Binance Vision aggTrades:
 *   aggTradeId, price, qty, firstId, lastId, timestamp, isBuyerMaker, isBestMatch
 */
function mkLine(aggId: number, price: number, qty: number, ts: number, isBuyerMaker: boolean): string {
  return `${aggId},${price},${qty},${aggId * 10},${aggId * 10 + 9},${ts},${isBuyerMaker ? 'True' : 'False'},True`;
}

describe('aggregateCsvToCandles', () => {
  it('агрегирует трейды с ms-timestamps в 5m свечи', () => {
    // 2026-01-01 12:00:00 UTC = 1767268800000 ms (для понятности дат)
    const T0 = 1767268800000;
    const csv = [
      mkLine(1, 100, 0.5, T0 + 1000, false),       // buy @ 100, ts 12:00:01
      mkLine(2, 101, 1.0, T0 + 2000, true),        // sell @ 101, ts 12:00:02
      mkLine(3, 102, 0.3, T0 + 200_000, false),    // buy @ 102, ts 12:03:20 (same 5m)
      mkLine(4, 103, 0.4, T0 + 350_000, false),    // buy @ 103, ts 12:05:50 (new 5m)
    ].join('\n');
    const candles = aggregateCsvToCandles(csv, 0.01, () => {});

    expect(candles).toHaveLength(2);
    expect(candles[0]!.timestamp).toBe(T0);                  // 12:00:00 UTC bucket
    expect(candles[1]!.timestamp).toBe(T0 + 5 * 60 * 1000);  // 12:05:00 UTC bucket
    expect(candles[0]!.open).toBe(100);
    expect(candles[0]!.close).toBe(102);
    expect(candles[0]!.high).toBe(102);
    expect(candles[0]!.low).toBe(100);
  });

  it('нормализует μs-timestamps (Binance изменил формат для новых символов)', () => {
    // 2026-01-01 12:00:00 UTC в МИКРОсекундах = 1767268800000 * 1000 = 1.767e15
    const T0_us = 1767268800000 * 1000;
    const csv = [
      mkLine(1, 100, 0.5, T0_us + 1_000_000, false),       // +1s в μs
      mkLine(2, 101, 1.0, T0_us + 2_000_000, true),        // +2s
      mkLine(3, 102, 0.3, T0_us + 200_000_000, false),     // +3:20
      mkLine(4, 103, 0.4, T0_us + 350_000_000, false),     // +5:50 → новый бакет
    ].join('\n');
    const candles = aggregateCsvToCandles(csv, 0.01, () => {});

    // После деления на 1000 поведение идентично ms-кейсу.
    expect(candles).toHaveLength(2);
    const T0_ms = 1767268800000;
    expect(candles[0]!.timestamp).toBe(T0_ms);
    expect(candles[1]!.timestamp).toBe(T0_ms + 5 * 60 * 1000);
    // Регресс-проверка: год не должен улететь в +058332.
    expect(new Date(candles[0]!.timestamp).getUTCFullYear()).toBe(2026);
  });

  it('игнорирует header-строку если она присутствует', () => {
    const T0 = 1767268800000;
    const csv = [
      'agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker,is_best_match',
      mkLine(1, 100, 0.5, T0 + 1000, false),
      mkLine(2, 101, 0.3, T0 + 2000, true),
    ].join('\n');
    const candles = aggregateCsvToCandles(csv, 0.01, () => {});

    expect(candles).toHaveLength(1);
    expect(candles[0]!.timestamp).toBe(T0);
  });

  it('пустой CSV → пустой массив', () => {
    expect(aggregateCsvToCandles('', 0.01, () => {})).toEqual([]);
    expect(aggregateCsvToCandles('\n\n', 0.01, () => {})).toEqual([]);
  });

  it('считает delta = ask - bid внутри свечи', () => {
    const T0 = 1767268800000;
    const csv = [
      // taker buy = isBuyerMaker false = ask +1.0
      mkLine(1, 100, 1.0, T0 + 1000, false),
      // taker sell = isBuyerMaker true = bid +0.4
      mkLine(2, 100, 0.4, T0 + 2000, true),
    ].join('\n');
    const candles = aggregateCsvToCandles(csv, 0.01, () => {});
    expect(candles).toHaveLength(1);
    expect(candles[0]!.delta).toBeCloseTo(0.6); // 1.0 ask - 0.4 bid
    expect(candles[0]!.volume).toBeCloseTo(1.4);
  });

  // ==========================================================================
  // Регрессия 1.43.1: tickSize должен приходить из symbols.ts, а не из
  // хардкода. Раньше для TONUSDT/SOLUSDT/BNBUSDT был fallback на 0.1 — для
  // токена за $5 это означало бакеты по 2% цены, кластеры схлопывались, и
  // 4-правильный сигнал не срабатывал на extended-бэктесте.
  //
  // Эти тесты фиксируют что:
  //   а) с правильной сеткой (0.001 для TON) близкие цены остаются в РАЗНЫХ
  //      кластерах — VPOC и delta_at_low/high имеют смысл
  //   б) с грубой сеткой (0.1) те же цены схлопываются в один кластер —
  //      демонстрация бага, который был до 1.43.1
  // ==========================================================================
  describe('tickSize: TON-сетка против неправильного fallback', () => {
    const T0 = 1767268800000;
    /** Шесть трейдов у TON-токена на цене ~$5 с шагом 0.001. */
    const tonTrades = [
      mkLine(1, 5.000, 1.0, T0 + 100, false),
      mkLine(2, 5.001, 1.5, T0 + 200, false),
      mkLine(3, 5.002, 2.0, T0 + 300, false),
      mkLine(4, 5.003, 1.0, T0 + 400, true),
      mkLine(5, 5.004, 0.5, T0 + 500, true),
      mkLine(6, 5.005, 0.3, T0 + 600, true),
    ].join('\n');

    it('tickSize=0.001 (правильная TON-сетка) — 6 раздельных кластеров', () => {
      const candles = aggregateCsvToCandles(tonTrades, 0.001, () => {});
      expect(candles).toHaveLength(1);
      const c = candles[0]!;
      // Каждый трейд в своём бакете → 6 уникальных уровней.
      expect(c.clusters).toHaveLength(6);
      // Уровни идут от low до high с шагом ровно 0.001.
      const prices = c.clusters.map((cl) => cl.price);
      expect(prices[0]).toBeCloseTo(5.000, 3);
      expect(prices[5]).toBeCloseTo(5.005, 3);
      // VPOC = уровень с максимальным объёмом = 5.002 (qty=2.0).
      expect(c.vpoc_price).toBeCloseTo(5.002, 3);
      // delta_at_low: на 5.000 трейд isBuyerMaker=false → ask, delta>0
      expect(c.delta_at_low).toBeCloseTo(1.0, 3);
      // delta_at_high: на 5.005 trader maker=true → bid, delta<0
      expect(c.delta_at_high).toBeCloseTo(-0.3, 3);
    });

    it('tickSize=0.1 (старый сломанный fallback) — все цены схлопываются в 1 кластер', () => {
      const candles = aggregateCsvToCandles(tonTrades, 0.1, () => {});
      expect(candles).toHaveLength(1);
      const c = candles[0]!;
      // Все 6 цен 5.000..5.005 округляются к одному бакету 5.0.
      expect(c.clusters).toHaveLength(1);
      expect(c.clusters[0]!.price).toBeCloseTo(5.0, 1);
      // VPOC == low == high — никакой структуры внутри свечи нет.
      expect(c.vpoc_price).toBe(c.clusters[0]!.price);
      // delta_at_low == delta_at_high — невозможно различить «поглощение в low»
      // от «поглощение в high». R4 правила сканера ВСЕГДА получает одно
      // значение → не срабатывает корректно.
      expect(c.delta_at_low).toBe(c.delta_at_high);
    });

    it('tickSize=5 (правильная BTC-сетка) — близкие цены в одном бакете', () => {
      // Источник правды: data/symbols.ts → BTCUSDT tickSize=5.
      // Bucket = Math.round(price/tickSize). При tickSize=5:
      //   60100 → round(12020.0) = 12020 → price 60100
      //   60102 → round(12020.4) = 12020 → price 60100 (тот же бакет)
      //   60110 → round(12022.0) = 12022 → price 60110 (отдельный бакет)
      const btcTrades = [
        mkLine(1, 60100, 0.5, T0 + 100, false),
        mkLine(2, 60102, 1.0, T0 + 200, false),
        mkLine(3, 60110, 0.3, T0 + 300, true),
      ].join('\n');
      const candles = aggregateCsvToCandles(btcTrades, 5, () => {});
      expect(candles).toHaveLength(1);
      const c = candles[0]!;
      // 2 уникальных бакета: 60100 (объединяет 60100+60102) и 60110.
      expect(c.clusters).toHaveLength(2);
      expect(c.clusters[0]!.price).toBe(60100);
      expect(c.clusters[0]!.vol).toBeCloseTo(1.5, 3); // 0.5 + 1.0
      expect(c.clusters[1]!.price).toBe(60110);
      expect(c.clusters[1]!.vol).toBeCloseTo(0.3, 3);
    });
  });
});
