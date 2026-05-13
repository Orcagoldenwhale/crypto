import { describe, it, expect } from 'vitest';
import { daysForCandles, EXTENDED_CANDLE_OPTIONS } from './BacktestPanelExtended';

describe('daysForCandles', () => {
  it('считает количество 5m-дней с округлением вверх', () => {
    expect(daysForCandles(288)).toBe(1);           // ровно один день
    expect(daysForCandles(289)).toBe(2);           // на одну свечу больше → второй день
    expect(daysForCandles(10000)).toBe(35);        // 35 × 288 = 10080 ≥ 10000
    expect(daysForCandles(50000)).toBe(174);       // 174 × 288 = 50112
    expect(daysForCandles(100000)).toBe(348);
  });

  it('не возвращает 0 даже для тривиально малых N', () => {
    expect(daysForCandles(0)).toBe(1);
    expect(daysForCandles(1)).toBe(1);
    expect(daysForCandles(100)).toBe(1);
  });

  it('EXTENDED_CANDLE_OPTIONS — 4 значения по возрастанию', () => {
    expect(EXTENDED_CANDLE_OPTIONS).toEqual([10000, 25000, 50000, 100000]);
  });
});
