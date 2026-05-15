import { checkSignal } from '@/scanner/checkSignal';
import type { Candle5m, Price, TimestampMs } from '@/types';
import type { SmcOverlay } from '@/engine/smc/types';
import type { BacktestSettings, BacktestReport, BacktestTrade } from './types';

/**
 * Окно подтверждения свинга для slBehindSwing (lookback по обе стороны).
 * 3 — стандартная SMC-конвенция для свингов на LTF; жёстко зашито, чтобы не
 * плодить параметры (если позже потребуется варьировать — выносим в settings).
 */
const SWING_LOOKBACK = 3;

interface SwingPoint {
  /** Индекс свечи-свинга в массиве candles. */
  index: number;
  /** low (для swing-low) или high (для swing-high) свечи. */
  price: number;
}

/**
 * Пред-расчёт всех свингов на LTF-свечах одним проходом.
 * Свинг = строгое >/< по обе стороны (плато не считается свингом —
 * та же конвенция, что в detectLiquidity / detectStructure).
 */
function findSwings(
  candles: readonly Candle5m[],
  lookback: number,
): { lows: SwingPoint[]; highs: SwingPoint[] } {
  const lows: SwingPoint[] = [];
  const highs: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i]!;
    let isLow = true;
    let isHigh = true;
    for (let k = i - lookback; k <= i + lookback; k++) {
      if (k === i) continue;
      const o = candles[k]!;
      if (o.low <= c.low) isLow = false;
      if (o.high >= c.high) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) lows.push({ index: i, price: c.low });
    if (isHigh) highs.push({ index: i, price: c.high });
  }
  return { lows, highs };
}

/**
 * Возвращает цену последнего ПОДТВЕРЖДЁННОГО свинга, удовлетворяющего
 * направлению сделки и расположению относительно entry:
 *   - LONG  → swing-low с price < entry (защищаем минимум снизу);
 *   - SHORT → swing-high с price > entry.
 *
 * Подтверждение: `swing.index + lookback < entryIdx` — между свингом и
 * entry-свечой прошло достаточно баров, чтобы свинг был «известен».
 * Это lookahead-safe.
 *
 * null = подходящего свинга не нашлось (slBehindSwing просто не даст
 * кандидата, останутся pctSl/wickSl).
 */
function findSwingSl(
  swings: readonly SwingPoint[],
  entryIdx: number,
  entryPrice: Price,
  lookback: number,
  side: 'low' | 'high',
): Price | null {
  for (let s = swings.length - 1; s >= 0; s--) {
    const sw = swings[s]!;
    if (sw.index + lookback >= entryIdx) continue;
    if (side === 'low' ? sw.price < entryPrice : sw.price > entryPrice) {
      return sw.price;
    }
  }
  return null;
}

/**
 * Сколько LTF-свечей ждать заполнения лимит-ордера для entryPoint ∈
 * {open, mt, wick}. Сигнал подтверждается на close свечи T → лимит-ордер
 * выставляется ПОСЛЕ закрытия → fill возможен только на T+1..T+N.
 * Если за N свечей цена не дотянулась — сделку пропускаем (трейдер бы её
 * отменил, чтобы не открывать вход в стухшей зоне).
 *
 * 10 — sensible default: на 5m это 50 минут, на 15m — 2.5 часа, на 1h —
 * 10 часов. Большинство ретестов происходят быстрее.
 */
const ENTRY_LIMIT_TIMEOUT_CANDLES = 10;

/**
 * Ищет первую свечу строго ПОСЛЕ сигнала (signalIdx+1..), на которой цена
 * коснулась target — это и есть fill лимит-ордера. Возвращает индекс fill-
 * свечи или null если за окно timeoutCandles не сработал.
 *
 * Lookahead-safe: signalIdx + 1 — сигнал уже подтверждён close'ом на
 * signalIdx, лимит ставится после close, заполнение возможно строго позже.
 */
function findEntryFillIdx(
  candles: readonly Candle5m[],
  signalIdx: number,
  timeoutCandles: number,
  target: Price,
  type: 'LONG' | 'SHORT',
): number | null {
  const endIdx = Math.min(candles.length, signalIdx + 1 + timeoutCandles);
  for (let j = signalIdx + 1; j < endIdx; j++) {
    const c = candles[j]!;
    const reached = type === 'LONG' ? c.low <= target : c.high >= target;
    if (reached) return j;
  }
  return null;
}

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
  /** Open уровень OB/BB-свечи (для entryPoint='open'). null для не-OB зон. */
  obOpenPrice: Price | null;
  /** Mean Threshold (50% тела OB/BB). null для не-OB зон. */
  obMtPrice: Price | null;
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
      obOpenPrice: null,
      obMtPrice: null,
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
      obOpenPrice: null,
      obMtPrice: null,
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
      obOpenPrice: ob.openPrice,
      obMtPrice: ob.mtPrice,
    });
  }

  for (const bb of overlay.breakerBlocks) {
    const h = bb.maxPrice - bb.minPrice;
    const gap = h * gapFrac;
    zones.push({
      id: `bb-${bb.id}`,
      startTime: bb.startTime,
      endTime: bb.endTime,
      minPrice: bb.minPrice - gap,
      maxPrice: bb.maxPrice + gap,
      fvgKind: null,
      fvgMinPrice: 0,
      fvgMaxPrice: 0,
      obKind: bb.kind,
      obOpenPrice: bb.openPrice,
      obMtPrice: bb.mtPrice,
    });
  }

  for (const rb of overlay.rejectionBlocks) {
    const h = rb.maxPrice - rb.minPrice;
    const gap = h * gapFrac;
    zones.push({
      id: `rb-${rb.id}`,
      startTime: rb.startTime,
      endTime: rb.endTime,
      minPrice: rb.minPrice - gap,
      maxPrice: rb.maxPrice + gap,
      fvgKind: null,
      fvgMinPrice: 0,
      fvgMaxPrice: 0,
      obKind: rb.kind,
      // RB не имеет классических Open уровней, но MT = середина фитиля.
      // Это и есть точка, от которой целесообразно входить.
      obOpenPrice: null,
      obMtPrice: rb.mtPrice,
    });
  }

  for (const s of overlay.structure) {
    const band = s.level * 0.001;
    const gap = band * gapFrac;
    // FIX (lookahead): startTime раньше был s.levelTime (момент свинг-точки).
    // Но свинг становится «известным» только после lookback подтверждающих
    // свечей; до этого торговать на нём — это будущая информация.
    // Самое раннее «гарантированно подтверждённое» событие = breakTime
    // (момент пробоя — детектор фиксирует свинг как уровень и одновременно
    // отмечает его пробой). Торгуем зону на retest после break:
    //   active = [breakTime, retestTime ?? breakTime]
    // Если retest не произошёл — endTime == startTime → пустая зона (нет
    // сделок, как и должно быть без подтверждённого ретеста).
    zones.push({
      id: `str-${s.id}`,
      startTime: s.breakTime,
      endTime: s.retestTime ?? s.breakTime,
      minPrice: s.level - band - gap,
      maxPrice: s.level + band + gap,
      fvgKind: null,
      fvgMinPrice: 0,
      fvgMaxPrice: 0,
      obKind: null,
      obOpenPrice: null,
      obMtPrice: null,
    });
  }

  return zones;
}

function candleInZone(candle: Candle5m, zone: SmcZoneRect): boolean {
  if (candle.timestamp <= zone.startTime || candle.timestamp > zone.endTime) return false;
  if (candle.high < zone.minPrice || candle.low > zone.maxPrice) return false;
  return true;
}

/**
 * Возвращает таргет лимит-ордера для не-close режимов или null если режим
 * close (тогда entry = close сигнальной свечи, лимит не нужен).
 * Для зон без OB-уровней (FVG/liquidity/structure) target=null →
 * автоматически fallback на close (см. caller).
 */
function computeLimitTarget(
  zone: SmcZoneRect,
  type: 'LONG' | 'SHORT',
  mode: BacktestSettings['entryPoint'],
): Price | null {
  if (mode === 'close') return null;
  if (zone.obKind === null) return null; // не-OB зона → нет mt/open/wick
  if (mode === 'open') return zone.obOpenPrice;
  if (mode === 'mt') return zone.obMtPrice;
  if (mode === 'wick') return type === 'LONG' ? zone.minPrice : zone.maxPrice;
  return null;
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
  /** Зоны, инвалидированные пробитием MT телом свечи. */
  const zoneMtBreached = new Set<string>();
  const debug = settings.debugLog;
  const log: string[] = [];
  const trace = debug ? (msg: string) => { log.push(msg); } : () => {};
  const fmt = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Длительность одной свечи в мс — для проверки возраста FVG-зон в свечах.
  // Берём дельту между первыми двумя свечами (LTF-grid однороден).
  const msPerCandle = candles.length >= 2
    ? candles[1]!.timestamp - candles[0]!.timestamp
    : 5 * 60 * 1000;

  // Пред-расчёт свингов для slBehindSwing. Считаем всегда (дёшево, O(n) при
  // фиксированном lookback) — даёт стабильную структуру независимо от того,
  // включён ли toggle. Если выключен — массивы просто не используются.
  const swings = settings.slBehindSwing
    ? findSwings(candles, SWING_LOOKBACK)
    : { lows: [], highs: [] };

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
        // MT-breach: тело свечи закрылось за MT → зона невалидна.
        if (settings.validityByMt && zone.obKind !== null && zone.obMtPrice !== null
            && candle.timestamp > zone.startTime && !zoneMtBreached.has(zone.id)) {
          const breached = zone.obKind === 'bull'
            ? candle.close < zone.obMtPrice
            : candle.close > zone.obMtPrice;
          if (breached) zoneMtBreached.add(zone.id);
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
        // Возраст FVG-зоны в свечах. 0 = без лимита.
        if (settings.fvgMaxLifetimeCandles > 0) {
          const ageCandles = (candle.timestamp - zone.startTime) / msPerCandle;
          if (ageCandles > settings.fvgMaxLifetimeCandles) {
            trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=fvg_too_old (${Math.round(ageCandles)} > ${settings.fvgMaxLifetimeCandles} candles)`);
            continue;
          }
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

      // MT-validity: если включено и зона уже инвалидирована пробитием MT — skip.
      if (settings.validityByMt && zoneMtBreached.has(zone.id)) {
        trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=mt_breached`);
        continue;
      }

      const count = zoneEntryCount.get(zone.id) ?? 0;
      if (count > settings.maxReentries) {
        trace(`[BT] ${ts} ${check.type} SKIP zone=${zone.id} reason=max_reentries (${count} > ${settings.maxReentries})`);
        continue;
      }

      const type = check.type;

      // ---- Точка входа ----
      // close → entry на сигнальной свече (signal подтверждён closure).
      // open/mt/wick → лимит-ордер на target-уровне, fill ищем строго на
      // следующих свечах (lookahead-safe: лимит ставится ПОСЛЕ close сигнала,
      // заполниться может только на свечах i+1..i+TIMEOUT).
      const limitTarget = computeLimitTarget(zone, type, settings.entryPoint);
      let entryPrice: Price;
      let fillIdx: number;
      if (limitTarget === null) {
        // close-режим ИЛИ не-OB зона (mt/wick/open не применимы) → close.
        entryPrice = candle.close;
        fillIdx = i;
      } else {
        const f = findEntryFillIdx(
          candles,
          i,
          ENTRY_LIMIT_TIMEOUT_CANDLES,
          limitTarget,
          type,
        );
        if (f === null) {
          trace(`[BT] ${ts} ${type} SKIP zone=${zone.id} reason=limit_not_filled (${settings.entryPoint} target=${limitTarget.toFixed(2)}, ${ENTRY_LIMIT_TIMEOUT_CANDLES} candles)`);
          continue;
        }
        entryPrice = limitTarget;
        fillIdx = f;
      }

      matched = true;

      // ---- Stop-loss ----
      // Собираем все актуальные кандидаты на SL и выбираем БЛИЖАЙШИЙ к entry
      // (минимальное расстояние). Так stopPct работает как верхний предел
      // риска, а wick-SL / swing-SL не уводят стоп дальше чем нужно.
      const stopOffset = entryPrice * (settings.stopPct / 100);
      const pctSl: Price = type === 'LONG'
        ? entryPrice - stopOffset
        : entryPrice + stopOffset;
      const useObSl = settings.slBehindObWick && zone.obKind !== null;
      const useFvgSl = settings.slBehindFvgEdge && zone.fvgKind !== null;
      const wickSl: Price | null = (useObSl || useFvgSl)
        ? (type === 'LONG' ? zone.minPrice : zone.maxPrice)
        : null;
      const swingSl: Price | null = settings.slBehindSwing
        ? findSwingSl(
            type === 'LONG' ? swings.lows : swings.highs,
            i,
            entryPrice,
            SWING_LOOKBACK,
            type === 'LONG' ? 'low' : 'high',
          )
        : null;
      // Для LONG ближайший SL ниже entry = с НАИБОЛЬШЕЙ ценой.
      // Для SHORT ближайший SL выше entry = с НАИМЕНЬШЕЙ ценой.
      // pctSl присутствует всегда, wickSl/swingSl — опциональны.
      let stopPrice: Price = pctSl;
      if (wickSl !== null) {
        stopPrice = type === 'LONG' ? Math.max(stopPrice, wickSl) : Math.min(stopPrice, wickSl);
      }
      if (swingSl !== null) {
        stopPrice = type === 'LONG' ? Math.max(stopPrice, swingSl) : Math.min(stopPrice, swingSl);
      }

      // ---- Take-profit от актуального риска ----
      const risk = Math.abs(entryPrice - stopPrice);
      const takePrice = type === 'LONG'
        ? entryPrice + risk * settings.rewardRatio
        : entryPrice - risk * settings.rewardRatio;

      let outcome: BacktestTrade['outcome'] = 'open';
      let exitTime: TimestampMs | null = null;
      let exitPrice: Price | null = null;
      let pnlR = 0;

      // SL/TP ищем с fillIdx+1 — позже момента fill. На fillIdx сам fill
      // уже произошёл (его low/high коснулись target внутри свечи); считать
      // SL/TP на этой же свече было бы lookahead-приближением.
      for (let j = fillIdx + 1; j < candles.length; j++) {
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

      // Lookahead-инвариант: entry-свеча должна быть СТРОГО ПОЗЖЕ
      // zone.startTime (когда зона "стала известна"). candleInZone уже
      // проверяет это (`candle.timestamp > zone.startTime` strict), но
      // здесь явный лог — чтобы если детектор когда-нибудь выставит
      // startTime с lookahead'ом, мы поймали это сразу.
      // Для не-close-режимов entry = fill-свеча (candles[fillIdx]), которая
      // ещё позже сигнала — заведомо позже зоны.
      const entryCandle = candles[fillIdx]!;
      const ageMs = entryCandle.timestamp - zone.startTime;
      const ageCandles = msPerCandle > 0 ? Math.round(ageMs / msPerCandle) : 0;
      const fillDelay = fillIdx - i;
      const tsEntry = fmt(entryCandle.timestamp);
      trace(`[BT] ${ts} ${type} ENTRY zone=${zone.id} entry=${entryPrice.toFixed(2)} SL=${stopPrice.toFixed(2)} TP=${takePrice.toFixed(2)} zoneStart=${fmt(zone.startTime)} age=${ageCandles}c fillDelay=${fillDelay}c entryTs=${tsEntry} → ${outcome} ${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(1)}R`);
      // Защитный assert: если когда-нибудь это сработает — есть баг в
      // детекторе (startTime в будущем относительно entry).
      if (ageMs <= 0 && debug) {
        log.push(`[BT] !!! LOOKAHEAD invariant violated: entry ${tsEntry} <= zoneStart ${fmt(zone.startTime)}`);
      }

      const tradeId = `${zone.id}::${entryCandle.timestamp}::${type}::${count}`;
      trades.push({
        id: tradeId,
        type,
        zoneId: zone.id,
        entryNumber: count,
        entryTime: entryCandle.timestamp,
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
      if (settings.validityByMt && zone.obKind !== null && zone.obMtPrice !== null
          && candle.timestamp > zone.startTime && !zoneMtBreached.has(zone.id)) {
        const breached = zone.obKind === 'bull'
          ? candle.close < zone.obMtPrice
          : candle.close > zone.obMtPrice;
        if (breached) zoneMtBreached.add(zone.id);
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
