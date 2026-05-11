/**
 * Детектор Breaker Block (BB) — пробитого и развернувшегося Order Block.
 *
 * Логика (из лекции "Блоки поддержки. OB BB"):
 *   1. Берём mitigated OB (цена вернулась внутрь).
 *   2. Проверяем что после mitigation произошёл структурный пробой в
 *      ПРОТИВОПОЛОЖНУЮ сторону — bull-OB должен быть пробит вниз (BOS↓),
 *      bear-OB — пробит вверх (BOS↑).
 *   3. Этот пробитый OB становится BB с инвертированным `kind`:
 *      bull-OB → bear-BB (теперь сопротивление);
 *      bear-OB → bull-BB (теперь поддержка).
 *   4. Mitigation BB ищем как касание зоны после момента пробоя.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { BreakerBlockZone, OrderBlockZone, StructureBreak } from './types';

interface OhlcCandle {
  timestamp: number;
  high: number;
  low: number;
}

export function detectBreakerBlocks(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  orderBlocks: readonly OrderBlockZone[],
  breaks: readonly StructureBreak[],
): BreakerBlockZone[] {
  if (candles.length === 0 || orderBlocks.length === 0) return [];
  const arr = candles as readonly OhlcCandle[];
  const lastTime = arr[arr.length - 1]!.timestamp;
  const out: BreakerBlockZone[] = [];

  for (const ob of orderBlocks) {
    // BB можно сделать только из уже отработанного блока.
    if (ob.unmitigated) continue;

    // Нужен структурный пробой в противоположную сторону, случившийся
    // ПОСЛЕ mitigation OB (когда цена уже зашла в зону и пробила её).
    const oppositeDir: 'up' | 'down' = ob.kind === 'bull' ? 'down' : 'up';
    const reversalBreak = breaks.find(
      (b) => b.dir === oppositeDir && b.breakTime > ob.endTime,
    );
    if (!reversalBreak) continue;

    // BB активируется с момента пробоя. kind инвертируется.
    const kind: BreakerBlockZone['kind'] = ob.kind === 'bull' ? 'bear' : 'bull';
    const startTime = reversalBreak.breakTime;
    const startIdx = findIndexByTime(arr, startTime);
    if (startIdx < 0) continue;

    // Mitigation BB: первая свеча после пробоя, которая зашла в зону.
    const mitTime = findMitigation(arr, startIdx + 1, kind, ob.minPrice, ob.maxPrice);

    out.push({
      id: `bb-${kind}-${ob.id}`,
      kind,
      startTime,
      endTime: mitTime !== null ? mitTime : lastTime,
      obTime: ob.obTime,
      minPrice: ob.minPrice,
      maxPrice: ob.maxPrice,
      mtPrice: ob.mtPrice,
      openPrice: ob.openPrice,
      unmitigated: mitTime === null,
      sourceObId: ob.id,
    });
  }

  out.sort((a, b) => a.startTime - b.startTime);
  return out;
}

function findIndexByTime(arr: readonly OhlcCandle[], time: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid]!.timestamp;
    if (v === time) return mid;
    if (v < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function findMitigation(
  arr: readonly OhlcCandle[],
  from: number,
  kind: 'bull' | 'bear',
  minPrice: number,
  maxPrice: number,
): number | null {
  for (let k = from; k < arr.length; k++) {
    const c = arr[k]!;
    // bull-BB снизу (поддержка): касание сверху, low ≤ maxPrice
    // bear-BB сверху (сопротивление): high ≥ minPrice
    if (kind === 'bull' ? c.low <= maxPrice : c.high >= minPrice) {
      return c.timestamp;
    }
  }
  return null;
}
