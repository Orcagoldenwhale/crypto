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
});
