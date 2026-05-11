import { checkSignal } from '@/scanner/checkSignal';
import type { Candle5m, Price, TimestampMs } from '@/types';
import type { SmcOverlay } from '@/engine/smc/types';
import type { BacktestSettings, BacktestReport, BacktestTrade } from './types';

export interface SmcZoneRect {
  id: string;
  startTime: TimestampMs;
  endTime: TimestampMs;
  minPrice: Price;
  maxPrice: Price;
  fvgKind: 'bull' | 'bear' | null;
  fvgMinPrice: Price;
  fvgMaxPrice: Price;
  /** bull OB → LONG only, bear OB → SHORT only, null → без ограничения. */
  obKind: 'bull' | 'bear' | null;
}

/**
 * Собирает прямоугольные зоны из SmcOverlay (только включённые слои уже отфильтрованы).
 * Расширяет каждую зону на zoneGapPct % от её высоты.
 */
export function collectZones(overlay: SmcOverlay, zoneGapPct: number): SmcZoneRect[] {
  const gapFrac = zoneGapPct / 100;
  const zones: SmcZoneRect[] = [];

  for (const fvg of overlay.fvgs) {
    const h = fvg.maxPrice - fvg.minPrice;
    const gap = h * gapFrac;
    zones.push({
      id: `fvg-${fvg.id}`,
      startTime: fvg.startTime,
      endTime: fvg.endTime,
      minPrice: fvg.minPrice - gap,
      maxPrice: fvg.maxPrice + gap,
      fvgKind: fvg.kind,
      fvgMinPrice: fvg.minPrice,
      fvgMaxPrice: fvg.maxPrice,
      obKind: null,
    });
  }

  for (const liq of overlay.liquidity) {
    const band = liq.price * 0.001;
    const gap = band * gapFrac;
    zones.push({
      id: `liq-${liq.id}`,
      startTime: liq.startTime,
      endTime: liq.endTime,
      minPrice: liq.price - band - gap,
      maxPrice: liq.price + band + gap,
      fvgKind: null,
      fvgMinPrice: 0,
      fvgMaxPrice: 0,
      obKind: null,
    });
  }

  for (const ob of overlay.orderBlocks) {
    const h = ob.maxPrice - ob.minPrice;
    const gap = h * gapFrac;
    zones.push({
      id: `ob-${ob.id}`,
      startTime: ob.startTime,
      endTime: ob.endTime,
      minPrice: ob.minPrice - gap,
      maxPrice: ob.maxPrice + gap,
      fvgKind: null,
      fvgMinPrice: 0,
      fvgMaxPrice: 0,
      obKind: ob.kind,
    });
  }

  for (const s of overlay.structure) {
    const band = s.level * 0.001;
    const gap = band * gapFrac;
    zones.push({
      id: `str-${s.id}`,
      startTime: s.levelTime,
      endTime: s.retestTime ?? s.breakTime,
      minPrice: s.level - band - gap,
      maxPrice: s.level + band + gap,
      fvgKind: null,
      fvgMinPrice: 0,
      fvgMaxPrice: 0,
      obKind: null,
    });
  }

  return zones;
}

function candleInZone(candle: Candle5m, zone: SmcZoneRect): boolean {
  if (candle.timestamp <= zone.startTime || candle.timestamp > zone.endTime) return false;
  if (candle.high < zone.minPrice || candle.low > zone.maxPrice) return false;
  return true;
}

function fvgFillPct(zone: SmcZoneRect, candle: Candle5m): number {
  if (zone.fvgKind === null) return 0;
  const height = zone.fvgMaxPrice - zone.fvgMinPrice;
  if (height <= 0) return 0;
  if (zone.fvgKind === 'bull') {
    const penetration = zone.fvgMaxPrice - candle.low;
    return Math.max(0, Math.min(100, (penetration / height) * 100));
  }
  const penetration = candle.high - zone.fvgMinPrice;
  return Math.max(0, Math.min(100, (penetration / height) * 100));
}

export function runBacktest(
  candles: readonly Candle5m[],
  overlay: SmcOverlay,
  settings: BacktestSettings,
): BacktestReport {
  const zones = collectZones(overlay, settings.zoneGapPct);
  const trades: BacktestTrade[] = [];
  const zoneEntryCount = new Map<string, number>();
  const zoneFillMax = new Map<string, number>();
  const debug = settings.debugLog;
  const log: string[] = [];
  const trace = debug ? (msg: string) => { log.push(msg); } : () => {};
  const fmt = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;

    const check = checkSignal(candle);
    if (check.type === null) {
      for (const zone of zones) {
        if (zone.fvgKind !== null && candle.timestamp > zone.startTime) {
          const fill = fvgFillPct(zone, candle);
          const prev = zoneFillMax.get(zone.id) ?? 0;
          if (fill > prev) zoneFillMax.set(zone.id, fill);
        }
      }
      continue;
    }

    const ts = fmt(candle.timestamp);
    const bodyPct = (Math.abs(candle.close - candle.open) / candle.close) * 100;

    if (settings.maxCandleBodyPct > 0 && bodyPct > settings.maxCandleBodyPct) {
      trace(`[BT] ${ts} ${check.type} SKIP body=${bodyPct.toFixed(3)}% > max=${settings.maxCandleBodyPct}%  C=${candle.close}`);
      continue;
    }

    let matched = false;
    for (const zone of zones) {
      if (!candleInZone(candle, zone)) continue;

      if (zone.fvgKind !== null) {
        if (zone.fvgKind === 'bull' && check.type !== 'LONG') {
          trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=direction (bull FVG, need LONG)`);
          continue;
        }
        if (zone.fvgKind === 'bear' && check.type !== 'SHORT') {
          trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=direction (bear FVG, need SHORT)`);
          continue;
        }
        const fvgHeight = zone.fvgMaxPrice - zone.fvgMinPrice;
        const fvgPct = (fvgHeight / zone.fvgMinPrice) * 100;
        if (settings.minFvgPct > 0 && fvgPct < settings.minFvgPct) {
          trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=fvg_too_small (${fvgPct.toFixed(3)}% < ${settings.minFvgPct}%)`);
          continue;
        }
        const maxFill = zoneFillMax.get(zone.id) ?? 0;
        if (maxFill > settings.fvgMaxFillPct) {
          trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=fvg_filled (${maxFill.toFixed(1)}% > ${settings.fvgMaxFillPct}%)`);
          continue;
        }
      }

      if (zone.obKind !== null) {
        if (zone.obKind === 'bull' && check.type !== 'LONG') {
          trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=direction (bull OB, need LONG)`);
          continue;
        }
        if (zone.obKind === 'bear' && check.type !== 'SHORT') {
          trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=direction (bear OB, need SHORT)`);
          continue;
        }
      }

      const count = zoneEntryCount.get(zone.id) ?? 0;
      if (count > settings.maxReentries) {
        trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=max_reentries (${count} > ${settings.maxReentries})`);
        continue;
      }

      matched = true;

      const type = check.type;
      const entryPrice = candle.close;
      const stopOffset = entryPrice * (settings.stopPct / 100);

      let stopPrice: Price;
      let takePrice: Price;

      if (type === 'LONG') {
        stopPrice = entryPrice - stopOffset;
        const risk = entryPrice - stopPrice;
        takePrice = entryPrice + risk * settings.rewardRatio;
      } else {
        stopPrice = entryPrice + stopOffset;
        const risk = stopPrice - entryPrice;
        takePrice = entryPrice - risk * settings.rewardRatio;
      }

      let outcome: BacktestTrade['outcome'] = 'open';
      let exitTime: TimestampMs | null = null;
      let exitPrice: Price | null = null;
      let pnlR = 0;

      for (let j = i + 1; j < candles.length; j++) {
        const future = candles[j]!;
        if (type === 'LONG') {
          if (future.low <= stopPrice) {
            outcome = 'loss';
            exitTime = future.timestamp;
            exitPrice = stopPrice;
            pnlR = -1;
            break;
          }
          if (future.high >= takePrice) {
            outcome = 'win';
            exitTime = future.timestamp;
            exitPrice = takePrice;
            pnlR = settings.rewardRatio;
            break;
          }
        } else {
          if (future.high >= stopPrice) {
            outcome = 'loss';
            exitTime = future.timestamp;
            exitPrice = stopPrice;
            pnlR = -1;
            break;
          }
          if (future.low <= takePrice) {
            outcome = 'win';
            exitTime = future.timestamp;
            exitPrice = takePrice;
            pnlR = settings.rewardRatio;
            break;
          }
        }
      }

      trace(`[BT] ${ts} ${type} ENTRY zone=${zone.id} entry=${entryPrice.toFixed(2)} SL=${stopPrice.toFixed(2)} TP=${takePrice.toFixed(2)} → ${outcome} ${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(1)}R`);

      const tradeId = `${zone.id}::${candle.timestamp}::${type}::${count}`;
      trades.push({
        id: tradeId,
        type,
        zoneId: zone.id,
        entryNumber: count,
        entryTime: candle.timestamp,
        entryPrice,
        stopPrice,
        takePrice,
        outcome,
        exitTime,
        exitPrice,
        pnlR,
      });

      if (outcome === 'loss' || settings.reentryAfterWin) {
        zoneEntryCount.set(zone.id, count + 1);
      } else {
        zoneEntryCount.set(zone.id, settings.maxReentries + 1);
      }
    }

    if (!matched) {
      trace(`[BT] ${ts} ${check.type} NO_ZONE C=${candle.close.toFixed(2)} body=${bodyPct.toFixed(3)}%`);
    }

    for (const zone of zones) {
      if (zone.fvgKind !== null && candle.timestamp > zone.startTime) {
        const fill = fvgFillPct(zone, candle);
        const prev = zoneFillMax.get(zone.id) ?? 0;
        if (fill > prev) zoneFillMax.set(zone.id, fill);
      }
    }
  }

  const wins = trades.filter((t) => t.outcome === 'win').length;
  const losses = trades.filter((t) => t.outcome === 'loss').length;
  const openTrades = trades.filter((t) => t.outcome === 'open').length;
  const closed = wins + losses;
  const totalPnlR = trades.reduce((sum, t) => sum + t.pnlR, 0);

  let maxConsecutiveLosses = 0;
  let currentStreak = 0;
  for (const t of trades) {
    if (t.outcome === 'loss') {
      currentStreak++;
      if (currentStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentStreak;
    } else if (t.outcome === 'win') {
      currentStreak = 0;
    }
  }

  if (debug) {
    const first = candles.length > 0 ? fmt(candles[0]!.timestamp) : '?';
    const last = candles.length > 0 ? fmt(candles[candles.length - 1]!.timestamp) : '?';
    const header = `Backtest @ ${new Date().toISOString()}: ${trades.length} trades, ${wins}W/${losses}L, ${totalPnlR >= 0 ? '+' : ''}${totalPnlR.toFixed(1)}R\nSettings: ${JSON.stringify(settings)}\nZones: ${zones.length}\nCandles: ${candles.length} (${first} … ${last})\n${'='.repeat(80)}`;
    const logText = header + '\n' + log.join('\n');
    try {
      fetch('/api/bt-log', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: logText,
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  return {
    totalTrades: trades.length,
    wins,
    losses,
    openTrades,
    winRate: closed > 0 ? wins / closed : 0,
    totalPnlR,
    avgPnlR: closed > 0 ? totalPnlR / closed : 0,
    maxConsecutiveLosses,
    trades,
  };
}
