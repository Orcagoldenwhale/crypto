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

/** Диагностика для UI и DevTools — сколько прилетело и сколько обработано. */
export interface LiveDebugStats {
  /** Сколько тиков было ingest'нуто (после дедупа — тех, что реально применились). */
  ticksReceived: number;
  /** Сколько snapshot'ов было эмитнуто наружу (через throttle). */
  snapshotsEmitted: number;
  /** Сколько 5m-свечей было закрыто после старта. */
  candlesClosed: number;
  /**
   * `Date.now()` последнего реально применённого тика. 0 если тиков ещё не
   * было. По разнице с now() UI показывает «последний тик: N сек назад» —
   * если значение растёт, WS работает; если стоит — стрим замолчал.
   */
  lastTickAt: number;
  /** Сколько кластеров в текущей открытой свече (быстрый health-check). */
  openCandleClusters: number;
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

  /**
   * Минимальный интервал между emit'ами snapshot'а open-свечи (мс).
   *
   * Зачем: на штормовом потоке (50–200 тиков/с) RAF триггерится 60 раз/сек,
   * каждый emit → пересчёт ВСЕХ агрегаций (15m, 1h, ltf-merge) и SMC-overlay.
   * На паре `1h-15m` это десятки тысяч операций × 60 раз/сек = главный поток
   * забит, переключение TF подвисает.
   *
   * 250 мс = 4 Гц — глаз видит «живую» цену, нагрузка падает в 15 раз.
   * **Закрытие 5m свечи** игнорирует throttle: оно редкое (раз в 5 мин)
   * и должно мгновенно триггерить пересчёт SMC/сканера.
   *
   * Default: 250.
   */
  snapshotIntervalMs?: number | undefined;

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
  /** Снимок счётчиков для UI/DevTools диагностики. */
  getDebugStats(): LiveDebugStats;
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
  const now = opts.now ?? (() => Date.now());
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? 250;

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
  // ===== Диагностика для UI / DevTools =====
  let ticksReceived = 0;
  let snapshotsEmitted = 0;
  let lastTickAt = 0;
  // ===== Throttle snapshot'ов =====
  // Время последнего emit'а snapshot — для дросселирования.
  let lastEmitAt = 0;
  // Флаг отложенного emit'а на конец окна throttle.
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
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

  function doEmit(): void {
    lastEmitAt = now();
    snapshotsEmitted++;
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    try {
      opts.onSnapshot(getSnapshot());
    } catch (e) {
      onError(e);
    }
  }

  /**
   * Эмитит snapshot с учётом throttle.
   *
   * Принципы:
   *  • `force=true` (close 5m, gap-fill page, manual flush) — игнорирует
   *    throttle, эмитит немедленно.
   *  • Если с прошлого emit прошло ≥ snapshotIntervalMs — эмитим сразу.
   *  • Иначе планируем trailing emit на конец окна (если ещё не запланирован),
   *    чтобы последняя цена не «застряла» в ожидании следующего тика.
   */
  function emitSnapshot(force = false): void {
    if (force || snapshotIntervalMs <= 0) {
      doEmit();
      return;
    }
    const elapsed = now() - lastEmitAt;
    if (elapsed >= snapshotIntervalMs) {
      doEmit();
      return;
    }
    if (throttleTimer) return;
    const wait = snapshotIntervalMs - elapsed;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (!stopped) doEmit();
    }, wait);
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
   *
   * Возвращает `true`, если случилось закрытие 5m свечи — вызывающий код
   * использует это для форсированного emit'а (минуя throttle).
   */
  function processTick(tick: AggTradeTick): boolean {
    // Дедуп: aggTradeId монотонно растёт. Защищаемся от overlap WS+gap-fill.
    if (tick.aggTradeId <= lastAggTradeId) return false;

    const slotStart = bucketTimestamp5m(tick.timestamp);
    let closedSlot = false;

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
        closedSlot = true;
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
    ticksReceived++;
    lastTickAt = now();
    dirty = true;
    return closedSlot;
  }

  function flushPending(): void {
    if (pending.length === 0) {
      rafScheduled = false;
      return;
    }
    const batch = pending.splice(0, pending.length);
    let hadClose = false;
    for (const t of batch) {
      if (processTick(t)) hadClose = true;
    }
    rafScheduled = false;
    emitSnapshot(hadClose);
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
          let hadClose = false;
          for (const t of ticks) {
            if (processTick(t)) hadClose = true;
          }
          // Страницы gap-fill редкие — форсим emit, чтобы пользователь сразу
          // увидел догнанные свечи.
          emitSnapshot(true);
          if (hadClose) {
            // Запись хвоста после закрытий — критично для persistence.
            scheduleSave();
          } else {
            scheduleSave();
          }
        },
      });
    } finally {
      // Сливаем накопленный буфер тиков, пришедших во время догона.
      if (gapBuffer.length > 0) {
        const flush = gapBuffer.splice(0, gapBuffer.length);
        let hadClose = false;
        for (const t of flush) {
          if (processTick(t)) hadClose = true;
        }
        emitSnapshot(hadClose);
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
      // Первый emit — форсим, чтобы UI сразу увидел восстановленный хвост.
      emitSnapshot(true);

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
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
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
    getDebugStats() {
      return {
        ticksReceived,
        snapshotsEmitted,
        candlesClosed: closed.length,
        lastTickAt,
        openCandleClusters: openCandle ? openCandle.clusters.length : 0,
      };
    },
  };
}
