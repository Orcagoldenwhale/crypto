import { describe, expect, it } from 'vitest';
import { dedupeZones } from './dedupeZones';
import type { POIZone } from '@/types';

const make = (id: string, st: number, et: number, lo: number, hi: number): POIZone => ({
  id,
  startTime: st,
  endTime: et,
  minPrice: lo,
  maxPrice: hi,
  hasSignal: false,
});

describe('dedupeZones', () => {
  it('возвращает пустой массив для пустого входа', () => {
    expect(dedupeZones([])).toEqual([]);
  });

  it('не трогает массив без дублей', () => {
    const zones = [
      make('a', 100, 200, 10, 20),
      make('b', 300, 400, 30, 40),
    ];
    expect(dedupeZones(zones)).toEqual(zones);
  });

  it('удаляет дубли с одинаковыми координатами но разными ID', () => {
    // Это РОВНО та регрессия из 1.11.0: Strict Mode → onCreate вызывается дважды,
    // каждый раз с новым UUID, но координаты идентичны.
    const zones = [
      make('uuid-1', 100, 200, 10, 20),
      make('uuid-2', 100, 200, 10, 20),
      make('uuid-3', 100, 200, 10, 20),
    ];
    const result = dedupeZones(zones);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('uuid-1');
  });

  it('сохраняет порядок и оставляет первую встреченную', () => {
    const zones = [
      make('a', 100, 200, 10, 20),
      make('b', 300, 400, 30, 40),
      make('a-dup', 100, 200, 10, 20),
      make('c', 500, 600, 50, 60),
      make('b-dup', 300, 400, 30, 40),
    ];
    const result = dedupeZones(zones);
    expect(result.map((z) => z.id)).toEqual(['a', 'b', 'c']);
  });

  it('считает зоны разными, если хотя бы одна граница отличается', () => {
    const zones = [
      make('a', 100, 200, 10, 20),
      make('b', 100, 200, 10, 21), // другая maxPrice
      make('c', 100, 201, 10, 20), // другая endTime
      make('d', 101, 200, 10, 20), // другая startTime
      make('e', 100, 200, 11, 20), // другая minPrice
    ];
    expect(dedupeZones(zones)).toEqual(zones);
  });

  it('не учитывает hasSignal как ключ — это эфемерное поле', () => {
    const a: POIZone = make('a', 100, 200, 10, 20);
    const aWithSignal: POIZone = { ...a, id: 'a2', hasSignal: true };
    const result = dedupeZones([a, aWithSignal]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('a');
  });
});
