/**
 * Тесты binanceLiveStream:
 *   - parseAggTradeMessage (чистая функция);
 *   - createBinanceLiveStream через инъекцию MockWebSocket — проверяем
 *     лайфцикл, парсинг, reconnect-backoff и stop().
 *
 * MockWebSocket — минимальный заместитель: даём полный контроль над тем,
 * когда триггерить onopen/onmessage/onclose, чтобы детерминистично гонять
 * сценарии без реальной сети.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBinanceLiveStream,
  parseAggTradeMessage,
  type LiveSocketLike,
} from './binanceLiveStream';
import type { AggTradeTick, LiveStatus } from '@/types';

class MockWebSocket implements LiveSocketLike {
  onopen: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, ev: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null;
  readyState = 0;
  url: string;

  static instances: MockWebSocket[] = [];
  static last(): MockWebSocket {
    const s = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!s) throw new Error('no MockWebSocket created yet');
    return s;
  }

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.call(this as unknown as WebSocket, new Event('open'));
  }
  message(payload: unknown): void {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.call(this as unknown as WebSocket, { data } as MessageEvent);
  }
  errorEvt(): void {
    this.onerror?.call(this as unknown as WebSocket, new Event('error'));
  }
  close(_code?: number): void {
    this.readyState = 3;
    this.onclose?.call(
      this as unknown as WebSocket,
      { code: _code ?? 1006 } as CloseEvent,
    );
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('parseAggTradeMessage', () => {
  it('валидный JSON: распарсен в AggTradeTick', () => {
    const raw = JSON.stringify({
      e: 'aggTrade',
      E: 1700000000000,
      s: 'BTCUSDT',
      a: 1234,
      p: '65430.5',
      q: '0.5',
      f: 100,
      l: 105,
      T: 1700000000123,
      m: true,
    });
    const t = parseAggTradeMessage(raw);
    expect(t).toEqual({
      aggTradeId: 1234,
      price: 65430.5,
      qty: 0.5,
      timestamp: 1700000000123,
      isBuyerMaker: true,
    } satisfies AggTradeTick);
  });

  it('non-string и невалидный JSON: возвращает null', () => {
    expect(parseAggTradeMessage(null)).toBeNull();
    expect(parseAggTradeMessage(123 as unknown)).toBeNull();
    expect(parseAggTradeMessage('{not-json')).toBeNull();
  });

  it('event != aggTrade: null', () => {
    expect(parseAggTradeMessage(JSON.stringify({ e: 'kline' }))).toBeNull();
  });

  it('пропущенные поля: null', () => {
    expect(
      parseAggTradeMessage(
        JSON.stringify({ e: 'aggTrade', a: 1, p: '1', T: 1 }),
      ),
    ).toBeNull(); // нет m, q
  });
});

describe('createBinanceLiveStream', () => {
  function makeStream(overrides: { onError?: (e: unknown) => void } = {}) {
    const ticks: AggTradeTick[] = [];
    const statuses: LiveStatus[] = [];
    const stream = createBinanceLiveStream({
      symbol: 'BTCUSDT',
      onTick: (t) => ticks.push(t),
      onStatus: (s) => statuses.push(s),
      onError: overrides.onError,
      socketCtor: (u) => new MockWebSocket(u),
      backoffSteps: [10, 50, 100], // быстрые backoff для тестов
    });
    return { stream, ticks, statuses };
  }

  it('start → connecting → onopen → live; парсит тики', () => {
    const { stream, ticks, statuses } = makeStream();
    stream.start();
    expect(statuses).toEqual(['connecting']);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.last().url).toBe(
      'wss://stream.binance.com:9443/ws/btcusdt@aggTrade',
    );

    MockWebSocket.last().open();
    expect(statuses).toEqual(['connecting', 'live']);

    MockWebSocket.last().message({
      e: 'aggTrade',
      a: 1,
      p: '100',
      q: '2',
      T: 1700000000000,
      m: false,
    });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.price).toBe(100);
  });

  it('disconnect (onclose) → reconnecting → новый сокет через backoff', () => {
    const { stream, statuses } = makeStream();
    stream.start();
    MockWebSocket.last().open();
    MockWebSocket.last().close(); // разрыв
    expect(statuses).toEqual(['connecting', 'live', 'reconnecting']);

    vi.advanceTimersByTime(10); // первый backoff = 10ms
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(statuses[statuses.length - 1]).toBe('connecting');

    MockWebSocket.last().open();
    expect(statuses[statuses.length - 1]).toBe('live');
  });

  it('backoff растёт с каждой попыткой и сбрасывается при успехе', () => {
    const { stream } = makeStream();
    stream.start();
    // attempt 1: connect → close → ждём 10
    MockWebSocket.last().close();
    vi.advanceTimersByTime(10);
    expect(MockWebSocket.instances).toHaveLength(2);

    // attempt 2: connect → close → ждём 50
    MockWebSocket.last().close();
    vi.advanceTimersByTime(50);
    expect(MockWebSocket.instances).toHaveLength(3);

    // attempt 3: connect → open → счётчик сбрасывается
    MockWebSocket.last().open();

    // close → снова с 10
    MockWebSocket.last().close();
    vi.advanceTimersByTime(10);
    expect(MockWebSocket.instances).toHaveLength(4);
  });

  it('stop() прекращает reconnect и закрывает сокет', () => {
    const { stream, statuses } = makeStream();
    stream.start();
    MockWebSocket.last().open();
    stream.stop();
    expect(statuses[statuses.length - 1]).toBe('idle');

    // close после stop не должен породить новый сокет
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('повторный start() — idempotent (не создаёт второй сокет)', () => {
    const { stream } = makeStream();
    stream.start();
    stream.start();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('socketCtor бросает исключение → ошибка логируется, идёт reconnect', () => {
    let throwOnce = true;
    const errors: unknown[] = [];
    const stream = createBinanceLiveStream({
      symbol: 'X',
      onTick: () => {},
      onStatus: () => {},
      onError: (e) => errors.push(e),
      socketCtor: (u) => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error('boom');
        }
        return new MockWebSocket(u);
      },
      backoffSteps: [5],
    });
    stream.start();
    expect(errors).toHaveLength(1);
    vi.advanceTimersByTime(5);
    expect(MockWebSocket.instances).toHaveLength(1); // 2-я попытка — успех
  });
});
