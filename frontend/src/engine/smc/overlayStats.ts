/**
 * Чистые helper-функции для диагностических подсчётов по SmcOverlay
 * и по списку сделок. Используются в dev-log payload'ах.
 *
 * Зачем отдельный модуль: эти функции вызываются и из handleRunBacktest
 * (App.tsx) и из handleRunExtended; вынесены чтобы:
 *   1. Не дублировать логику
 *   2. Иметь unit-тесты на агрегацию (App.tsx не тестируется напрямую
 *      без jsdom)
 */

import type { BacktestTrade } from '@/backtest/types';
import type { SmcOverlay } from './types';

export interface BullBearCount {
  bull: number;
  bear: number;
}

export interface OverlayKindStats {
  fvg: BullBearCount;
  orderBlocks: BullBearCount;
  breakerBlocks: BullBearCount;
  rejectionBlocks: BullBearCount;
  /** Liquidity: high/low — не bull/bear, отдельная семантика. */
  liquidity: { high: number; low: number };
}

/**
 * Считает bull/bear разбивку по каждому типу детектора в overlay.
 * Используется для диагностики «асимметрии детекторов» — если, например,
 * orderBlocks: { bull: 28, bear: 2 } — это явный перекос (либо рыночная
 * реальность тренда, либо баг в детекторе).
 */
export function computeOverlayKindStats(overlay: SmcOverlay): OverlayKindStats {
  const fvg = { bull: 0, bear: 0 };
  const orderBlocks = { bull: 0, bear: 0 };
  const breakerBlocks = { bull: 0, bear: 0 };
  const rejectionBlocks = { bull: 0, bear: 0 };
  const liquidity = { high: 0, low: 0 };

  for (const f of overlay.fvgs) {
    if (f.kind === 'bull') fvg.bull++;
    else fvg.bear++;
  }
  for (const ob of overlay.orderBlocks) {
    if (ob.kind === 'bull') orderBlocks.bull++;
    else orderBlocks.bear++;
  }
  for (const bb of overlay.breakerBlocks) {
    if (bb.kind === 'bull') breakerBlocks.bull++;
    else breakerBlocks.bear++;
  }
  for (const rb of overlay.rejectionBlocks) {
    if (rb.kind === 'bull') rejectionBlocks.bull++;
    else rejectionBlocks.bear++;
  }
  for (const liq of overlay.liquidity) {
    if (liq.kind === 'high') liquidity.high++;
    else liquidity.low++;
  }

  return { fvg, orderBlocks, breakerBlocks, rejectionBlocks, liquidity };
}

export interface TradesByZoneType {
  fvg: { total: number; long: number; short: number };
  ob: { total: number; long: number; short: number };
  bb: { total: number; long: number; short: number };
  rb: { total: number; long: number; short: number };
  liq: { total: number; long: number; short: number };
  str: { total: number; long: number; short: number };
  unknown: { total: number; long: number; short: number };
}

/**
 * Группирует сделки по типу зоны (FVG / OB / BB / RB / Liq / Structure)
 * через префикс `zone.id`. См. backtest/runBacktest.ts:collectZones — IDs
 * формируются как `fvg-...`, `ob-...`, `bb-...`, `rb-...`, `liq-...`, `str-...`.
 *
 * Полезно увидеть «из каких зон вообще приходят сделки» — если, например,
 * 95% сделок из rejectionBlocks, это сразу видно.
 */
export function computeTradesByZoneType(trades: readonly BacktestTrade[]): TradesByZoneType {
  const make = () => ({ total: 0, long: 0, short: 0 });
  const out: TradesByZoneType = {
    fvg: make(),
    ob: make(),
    bb: make(),
    rb: make(),
    liq: make(),
    str: make(),
    unknown: make(),
  };
  for (const t of trades) {
    const bucket = pickBucket(out, t.zoneId);
    bucket.total++;
    if (t.type === 'LONG') bucket.long++;
    else if (t.type === 'SHORT') bucket.short++;
  }
  return out;
}

function pickBucket(stats: TradesByZoneType, zoneId: string) {
  if (zoneId.startsWith('fvg-')) return stats.fvg;
  if (zoneId.startsWith('ob-')) return stats.ob;
  if (zoneId.startsWith('bb-')) return stats.bb;
  if (zoneId.startsWith('rb-')) return stats.rb;
  if (zoneId.startsWith('liq-')) return stats.liq;
  if (zoneId.startsWith('str-')) return stats.str;
  return stats.unknown;
}
