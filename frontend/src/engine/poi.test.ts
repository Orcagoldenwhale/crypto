import { describe, expect, it } from 'vitest';
import { hitTestZones, screenRectToZoneCoords } from './poi';
import type { CanvasMetrics, Viewport } from './scale';
import type { POIZone } from '@/types';

const VP: Viewport = {
  timeStart: 1_000_000,
  timeEnd: 2_000_000,
  priceMin: 100,
  priceMax: 200,
};

const M: CanvasMetrics = {
  width: 1000,
  height: 600,
  paddingRight: 0,
  paddingBottom: 0,
};

function zone(id: string, t1: number, t2: number, p1: number, p2: number): POIZone {
  return {
    id,
    startTime: t1,
    endTime: t2,
    minPrice: Math.min(p1, p2),
    maxPrice: Math.max(p1, p2),
    hasSignal: false,
  };
}

describe('screenRectToZoneCoords', () => {
  it('конвертирует прямоугольник из экранных координат в мировые', () => {
    // (0, 0) → (timeStart, priceMax), (width, height) → (timeEnd, priceMin)
    const r = screenRectToZoneCoords(0, 0, M.width, M.height, VP, M);
    expect(r.startTime).toBeCloseTo(VP.timeStart, 0);
    expect(r.endTime).toBeCloseTo(VP.timeEnd, 0);
    expect(r.startPrice).toBeCloseTo(VP.priceMax, 0);
    expect(r.endPrice).toBeCloseTo(VP.priceMin, 0);
  });

  it('центр экрана соответствует середине viewport', () => {
    const r = screenRectToZoneCoords(M.width / 2, M.height / 2, M.width / 2, M.height / 2, VP, M);
    expect(r.startTime).toBeCloseTo(1_500_000, 0);
    expect(r.startPrice).toBeCloseTo(150, 0);
  });
});

describe('hitTestZones', () => {
  it('возвращает null если зон нет', () => {
    expect(hitTestZones([], 100, 100, VP, M)).toBeNull();
  });

  it('возвращает зону, если курсор внутри', () => {
    const z = zone('z1', 1_200_000, 1_400_000, 120, 140);
    // 1_300_000 → (300/1000)*1000 = 300; 130 → priceY: 600-((130-100)/100)*600 = 600-180 = 420
    const hit = hitTestZones([z], 300, 420, VP, M);
    expect(hit?.id).toBe('z1');
  });

  it('возвращает null если курсор снаружи', () => {
    const z = zone('z1', 1_200_000, 1_400_000, 120, 140);
    expect(hitTestZones([z], 50, 50, VP, M)).toBeNull();
    expect(hitTestZones([z], 999, 999, VP, M)).toBeNull();
  });

  it('при перекрытии возвращает последнюю (визуально верхнюю) зону', () => {
    const z1 = zone('bottom', 1_200_000, 1_800_000, 120, 180);
    const z2 = zone('top', 1_300_000, 1_700_000, 130, 170);
    const hit = hitTestZones([z1, z2], 500, 300, VP, M);
    // (500, 300) находится в обеих → побеждает 'top' (последняя)
    expect(hit?.id).toBe('top');
  });

  it('правильно работает с инвертированной (рисованной снизу-вверх) зоной', () => {
    // Зоны хранят min/maxPrice нормализовано — но проверим, что hit-test всё равно работает.
    const z = zone('z1', 1_200_000, 1_400_000, 140, 120);
    const hit = hitTestZones([z], 300, 420, VP, M);
    expect(hit?.id).toBe('z1');
  });
});
