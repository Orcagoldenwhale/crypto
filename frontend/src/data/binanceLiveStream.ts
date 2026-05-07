/**
 * WebSocket-клиент для Binance aggTrade stream.
 *
 * Endpoint: wss://stream.binance.com:9443/ws/{symbol}@aggTrade
 * Документация: https://binance-docs.github.io/apidocs/spot/en/#aggregate-trade-streams
 *
 * Возможности:
 *   • парсинг и валидация JSON-сообщений → AggTradeTick;
 *   • автоматический reconnect с exponential backoff (1s → 2s → 5s → 15s → 30s, max 30s);
 *   • колбэки onTick, onStatus для интеграции в manager;
 *   • инъекция WebSocketCtor — чтобы тестировать с MockWebSocket без подключения.
 */

import type { AggTradeTick, LiveStatus } from '@/types';

/** Подмножество API WebSocket, которое мы используем (для DI в тестах). */
export interface LiveSocketLike {
  close(code?: number): void;
  readonly readyState: number;
  onopen: ((this: WebSocket, ev: Event) => unknown) | null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null;
}

export type LiveSocketCtor = (url: string) => LiveSocketLike;

export interface BinanceLiveStreamOptions {
  /** Тикер в верхнем регистре, например 'BTCUSDT'. */
  symbol: string;
  /** Колбэк на каждый тик. Может вызываться с очень высокой частотой (≥100/s). */
  onTick: (tick: AggTradeTick) => void;
  /** Колбэк на смену статуса. Удобно дебаунсить в UI. */
  onStatus: (status: LiveStatus) => void;
  /** Опциональный логгер ошибок (по умолчанию console.warn). */
  onError?: ((err: unknown) => void) | undefined;
  /**
   * Конструктор сокета. По умолчанию — глобальный WebSocket. Для юнит-тестов
   * можно передать MockWebSocket factory.
   */
  socketCtor?: LiveSocketCtor | undefined;
  /** Базовый URL стрима. По умолчанию — wss://stream.binance.com:9443/ws. */
  baseUrl?: string | undefined;
  /** Шаги reconnect-backoff в миллисекундах. */
  backoffSteps?: readonly number[] | undefined;
}

const DEFAULT_BACKOFF: readonly number[] = [1000, 2000, 5000, 15000, 30000];
const DEFAULT_BASE_URL = 'wss://stream.binance.com:9443/ws';

/** Состояние одного active connect-цикла. Меняется при start/stop/reconnect. */
interface InternalState {
  socket: LiveSocketLike | null;
  attempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean; // true если stop() был вызван и больше не должны переподключаться
}

export interface BinanceLiveStream {
  /** Открыть соединение. Idempotent: повторный вызов игнорируется. */
  start(): void;
  /** Закрыть соединение и отменить все таймеры reconnect. После stop() стрим мёртвый. */
  stop(): void;
  /** Текущее состояние (для отладки / тестов). */
  readonly status: LiveStatus;
}

export function createBinanceLiveStream(
  opts: BinanceLiveStreamOptions,
): BinanceLiveStream {
  const symbol = opts.symbol.toLowerCase();
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const backoff = opts.backoffSteps ?? DEFAULT_BACKOFF;
  const url = `${baseUrl}/${symbol}@aggTrade`;
  const onError = opts.onError ?? ((err: unknown) => console.warn('[live-ws]', err));
  const socketCtor: LiveSocketCtor =
    opts.socketCtor ?? ((u) => new WebSocket(u) as unknown as LiveSocketLike);

  const state: InternalState = {
    socket: null,
    attempt: 0,
    reconnectTimer: null,
    closed: false,
  };
  let currentStatus: LiveStatus = 'idle';

  function setStatus(next: LiveStatus): void {
    if (currentStatus === next) return;
    currentStatus = next;
    try {
      opts.onStatus(next);
    } catch (e) {
      onError(e);
    }
  }

  function scheduleReconnect(): void {
    if (state.closed) return;
    const delay = backoff[Math.min(state.attempt, backoff.length - 1)] ?? 30000;
    state.attempt += 1;
    setStatus('reconnecting');
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (state.closed) return;
    setStatus('connecting');
    let sock: LiveSocketLike;
    try {
      sock = socketCtor(url);
    } catch (e) {
      onError(e);
      scheduleReconnect();
      return;
    }
    state.socket = sock;

    sock.onopen = () => {
      // Сброс счётчика попыток — следующий разрыв снова начнёт с 1с.
      state.attempt = 0;
      setStatus('live');
    };
    sock.onmessage = (ev: MessageEvent) => {
      const tick = parseAggTradeMessage(ev.data);
      if (tick) {
        try {
          opts.onTick(tick);
        } catch (e) {
          onError(e);
        }
      }
    };
    sock.onerror = (ev: Event) => {
      onError(ev);
      // не меняем статус — следом всегда придёт onclose
    };
    sock.onclose = () => {
      state.socket = null;
      if (!state.closed) scheduleReconnect();
    };
  }

  return {
    start() {
      if (state.socket || state.reconnectTimer) return; // уже работает
      state.closed = false;
      state.attempt = 0;
      connect();
    },
    stop() {
      state.closed = true;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      if (state.socket) {
        try {
          state.socket.close(1000);
        } catch (e) {
          onError(e);
        }
        state.socket = null;
      }
      setStatus('idle');
    },
    get status() {
      return currentStatus;
    },
  };
}

/**
 * Распарсить одно сообщение aggTrade в AggTradeTick. Возвращает null
 * если сообщение невалидно (логируем мягко, не падаем).
 *
 * Формат (упрощённо):
 * {
 *   "e": "aggTrade", "E": 1633036800000,
 *   "s": "BNBUSDT", "a": 12345,
 *   "p": "0.001", "q": "100",
 *   "f": 100, "l": 105,        // first/last trade id
 *   "T": 1633036800001,         // trade time
 *   "m": true                   // isBuyerMaker
 * }
 */
export function parseAggTradeMessage(raw: unknown): AggTradeTick | null {
  if (typeof raw !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (o.e !== 'aggTrade') return null;
  const aggTradeId = typeof o.a === 'number' ? o.a : NaN;
  const price = typeof o.p === 'string' ? Number.parseFloat(o.p) : NaN;
  const qty = typeof o.q === 'string' ? Number.parseFloat(o.q) : NaN;
  const timestamp = typeof o.T === 'number' ? o.T : NaN;
  const isBuyerMaker = typeof o.m === 'boolean' ? o.m : null;
  if (
    !Number.isFinite(aggTradeId) ||
    !Number.isFinite(price) ||
    !Number.isFinite(qty) ||
    !Number.isFinite(timestamp) ||
    isBuyerMaker === null
  ) {
    return null;
  }
  return {
    aggTradeId,
    price,
    qty,
    timestamp,
    isBuyerMaker,
  };
}
