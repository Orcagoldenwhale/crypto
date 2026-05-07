/**
 * Оркестратор live-режима: связывает WebSocket-стрим, builder и persistence.
 *
 * Зачем нужен отдельный слой:
 *   • буферизация тиков и батч-применение на requestAnimationFrame —
 *     иначе при шторме (50–200 тиков/с) React будет ререндерить вечно;
 *   • детекция перехода 5m-границы (close → open) и триггер onCandleClosed
 *     для пересчёта SMC + сканера в App.tsx;
 *   • дедупликация по aggTradeId (для overlap'а WS и gap-recovery);
 *   • прокидывание статуса (LiveStatus) и сохранение прогресса в IDB.
 *
 * Manager не знает про React — это pure-объект, App.tsx просто вешает
 * колбэки. Тестируется без DOM.
 */

import {
  applyTickToCandle,
  bucketTimestamp5m,
  finalizeCandle,
  openNewCandle,
} from './liveCandleBuilder';
import { fillAggTradeGap } from './binanceGapFiller';
import {
  createBinanceLiveStream,
  type BinanceLiveStream,
  type LiveSocketCtor,
} from './binanceLiveStream';
import {
  loadLiveMeta,
  loadLiveTail,
  saveLiveMeta,
  saveLiveTail,
} from './storage';
import type { AggTradeTick, Candle5m, LiveStatus } from '@/types';

/** Снапшот состояния, который manager отдаёт наружу (App в стейт). */
export interface LiveCandleSnapshot {
  /** Закрытые live-свечи, пришедшие после старта (упорядочены по timestamp ↑). */
  closedCandles: Candle5m[];
  /** Текущая открытая свеча или null, если ни одного тика ещё не пришло. */
  openCandle: Candle5m | null;
}

export interface LiveCandleManagerOptions {
  symbol: string;
  tickSize: number;
  /** Колбэк при каждом RAF-апдейте состояния (изменилась open/closed свеча). */
  onSnapshot: (snap: LiveCandleSnapshot) => void;
  /** Колбэк при закрытии 5m свечи — App пересчитает SMC + сканер. */
  onCandleClosed: (closed: Candle5m) => void;
  /** Колбэк при смене статуса (UI показывает badge). */
  onStatus: (status: LiveStatus) => void;
  /** Логгер ошибок. */
  onError?: ((e: unknown) => void) | undefined;

  // ===== DI для тестов =====
  socketCtor?: LiveSocketCtor | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Override RAF: в тестах полезно вызывать схеду вручную. */
  rafScheduler?: ((cb: () => void) => void) | undefined;
  /** Опциональный override времени для детерминированных тестов. */
  now?: (() => number) | undefined;
}

export interface LiveCandleManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  applyTick(tick: AggTradeTick): void;
  applyTicksBatch(ticks: readonly AggTradeTick[]): void;
  readonly status: LiveStatus;
  readonly snapshot: LiveCandleSnapshot;
}

export function createLiveCandleManager(
  opts: LiveCandleManagerOptions,
): LiveCandleManager {
  const onError = opts.onError ?? ((e: unknown) => console.warn('[live-mgr]', e));
  const raf =
    opts.rafScheduler ??
    ((cb: () => void) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => cb());
      } else {
        setTimeout(cb, 16);
      }
    });

  // ===== Внутреннее состояние =====
  let status: LiveStatus = 'idle';
  let openCandle: Candle5m | null = null;
  const closed: Candle5m[] = [];
  let lastAggTradeId = -1;
  // Очередь тиков, ожидающих обработки в следующем RAF.
  const pending: AggTradeTick[] = [];
  let rafScheduled = false;
  // Bookkeeping persistence
  let dirty = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // WS-стрим (создаётся в start(), уничтожается в stop()).
  let stream: BinanceLiveStream | null = null;
  // Состояние gap-recovery: если идёт догон, новые тики из WS буферим, чтобы
  // не нарушить порядок закрытия свечей.
  let gapInProgress = false;
  const gapBuffer: AggTradeTick[] = [];
  // Флаг, чтобы stop() отменил все хвостовые RAF/timeouts.
  let stopped = false;

  function setStatus(next: LiveStatus): void {
    if (status === next) return;
    status = next;
    try {
      opts.onStatus(next);
    } catch (e) {
      onError(e);
    }
  }

  function getSnapshot(): LiveCandleSnapshot {
    // Делаем shallow-copy closed чтобы консьюмер не мутировал.
    return { closedCandles: closed.slice(), openCandle };
  }

  function emitSnapshot(): void {
    try {
      opts.onSnapshot(getSnapshot());
    } catch (e) {
      onError(e);
    }
  }

  function scheduleSave(): void {
    if (!dirty || stopped) return;
    if (saveTimer) return;
    // Дебаунс ≈1с — не пишем в IDB на каждом RAF, не нужно.
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (stopped) return;
      saveLiveTail(opts.symbol, closed).catch(onError);
      if (lastAggTradeId >= 0) {
        const lastTs = openCandle?.timestamp ?? closed[closed.length - 1]?.timestamp ?? 0;
        saveLiveMeta({
          symbol: opts.symbol,
          lastAggTradeId,
          lastTimestamp: lastTs,
        }).catch(onError);
      }
      dirty = false;
    }, 1000);
  }

  /**
   * Обработать один тик: дедуп → определить слот → close+open при пересечении
   * границы → applyTick → пометить dirty.
   */
  function processTick(tick: AggTradeTick): void {
    // Дедуп: aggTradeId монотонно растёт. Защищаемся от overlap WS+gap-fill.
    if (tick.aggTradeId <= lastAggTradeId) return;

    const slotStart = bucketTimestamp5m(tick.timestamp);

    if (!openCandle) {
      openCandle = openNewCandle(tick.timestamp);
    } else if (slotStart !== openCandle.timestamp) {
      // Перешли в новый слот → закрываем текущую, открываем новую.
      // Если slotStart MUCH дальше — между ними «дыра» без сделок;
      // не вставляем фиктивные пустые свечи (исторический рендерер
      // нормально обрабатывает gap по timestamp).
      const finalised = finalizeCandle(openCandle);
      if (finalised.clusters.length > 0) {
        closed.push(finalised);
        try {
          opts.onCandleClosed(finalised);
        } catch (e) {
          onError(e);
        }
      }
      openCandle = openNewCandle(tick.timestamp);
    }

    openCandle = applyTickToCandle(openCandle, tick, opts.tickSize);
    lastAggTradeId = tick.aggTradeId;
    dirty = true;
  }

  function flushPending(): void {
    if (pending.length === 0) {
      rafScheduled = false;
      return;
    }
    const batch = pending.splice(0, pending.length);
    for (const t of batch) processTick(t);
    rafScheduled = false;
    emitSnapshot();
    scheduleSave();
  }

  function scheduleFlush(): void {
    if (rafScheduled || stopped) return;
    rafScheduled = true;
    raf(() => {
      if (!stopped) flushPending();
    });
  }

  function ingest(tick: AggTradeTick): void {
    if (stopped) return;
    // Если идёт gap-recovery — копим тики из WS отдельно, применим после.
    if (gapInProgress) {
      gapBuffer.push(tick);
      return;
    }
    pending.push(tick);
    scheduleFlush();
  }

  async function performGapFill(fromId: number): Promise<void> {
    gapInProgress = true;
    setStatus('gap-filling');
    try {
      await fillAggTradeGap({
        symbol: opts.symbol,
        fromId,
        fetchImpl: opts.fetchImpl,
        onError,
        onPage: (ticks) => {
          for (const t of ticks) processTick(t);
          emitSnapshot();
          scheduleSave();
        },
      });
    } finally {
      // Сливаем накопленный буфер тиков, пришедших во время догона.
      if (gapBuffer.length > 0) {
        const flush = gapBuffer.splice(0, gapBuffer.length);
        for (const t of flush) processTick(t);
        emitSnapshot();
        scheduleSave();
      }
      gapInProgress = false;
      // После догона возвращаемся к 'live' (если стрим активен).
      if (stream && stream.status === 'live') setStatus('live');
    }
  }

  return {
    async start() {
      if (stream) return;
      stopped = false;

      // 1. Восстановить хвост и метаданные из IDB.
      try {
        const tail = await loadLiveTail(opts.symbol);
        if (tail.length > 0) closed.push(...tail);
        const meta = await loadLiveMeta(opts.symbol);
        if (meta) lastAggTradeId = meta.lastAggTradeId;
      } catch (e) {
        onError(e);
      }
      emitSnapshot();

      // 2. Создать WS-стрим.
      stream = createBinanceLiveStream({
        symbol: opts.symbol,
        socketCtor: opts.socketCtor,
        onError,
        onTick: (tick) => {
          ingest(tick);
        },
        onStatus: async (next) => {
          if (next === 'live') {
            // При первом подключении и при reconnect — пробуем gap-recovery.
            if (lastAggTradeId >= 0 && !gapInProgress) {
              // Не блокируем: запустим gap-fill параллельно, новые
              // WS-тики попадут в gapBuffer → применятся после.
              performGapFill(lastAggTradeId + 1).catch(onError);
              return;
            }
          }
          setStatus(next);
        },
      });
      stream.start();
    },

    async stop() {
      stopped = true;
      if (stream) {
        stream.stop();
        stream = null;
      }
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // Финальная запись хвоста.
      try {
        if (dirty) {
          await saveLiveTail(opts.symbol, closed);
          if (lastAggTradeId >= 0) {
            const lastTs =
              openCandle?.timestamp ?? closed[closed.length - 1]?.timestamp ?? 0;
            await saveLiveMeta({
              symbol: opts.symbol,
              lastAggTradeId,
              lastTimestamp: lastTs,
            });
          }
          dirty = false;
        }
      } catch (e) {
        onError(e);
      }
      setStatus('idle');
    },

    applyTick(tick) {
      ingest(tick);
    },
    applyTicksBatch(ticks) {
      for (const t of ticks) ingest(t);
    },

    get status() {
      return status;
    },
    get snapshot() {
      return getSnapshot();
    },
  };
}
