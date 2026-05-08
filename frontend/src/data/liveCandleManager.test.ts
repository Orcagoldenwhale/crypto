/**
 * Тесты оркестратора liveCandleManager — фокус на throttle snapshot'ов
 * и форсированный emit при закрытии 5m.
 *
 * Storage и WS-стрим мокаются (storage через fake-indexeddb через подмену
 * импортов; WS — через socketCtor: () => null mock не используется,
 * вместо этого тестируем applyTick напрямую — он минует stream).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLiveCandleManager,
  type LiveCandleSnapshot,
} from './liveCandleManager';
import { FIVE_MIN_MS } from './liveCandleBuilder';
import type { AggTradeTick } from '@/types';
import type { LiveSocketLike } from './binanceLiveStream';

// Подмена IDB — простой in-memory stub, чтобы start()/stop() не падали.
vi.mock('./storage', () => ({
  loadLiveTail: vi.fn(async () => []),
  loadLiveMeta: vi.fn(async () => null),
  saveLiveTail: vi.fn(async () => {}),
  saveLiveMeta: vi.fn(async () => {}),
}));

const T0 = 1762560000000; // 2025-11-07 20:00 UTC, выровнен на 5m
function tick(i: number, price: number, m = false, tsOffset = i * 100): AggTradeTick {
  return {
    aggTradeId: i,
    price,
    qty: 1,
    timestamp: T0 + tsOffset,
    isBuyerMaker: m,
  };
}

class NullSocket implements LiveSocketLike {
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  readyState = 0;
  close() {}
}

interface Harness {
  mgr: ReturnType<typeof createLiveCandleManager>;
  snaps: LiveCandleSnapshot[];
  // Контролируемое «сейчас» для throttle.
  setNow: (t: number) => void;
  // Принудительно выполнить отложенный RAF-flush.
  runRaf: () => void;
}

function makeHarness(snapshotIntervalMs = 250): Harness {
  const snaps: LiveCandleSnapshot[] = [];
  let nowMs = 0;
  let pendingRaf: (() => void) | null = null;
  const mgr = createLiveCandleManager({
    symbol: 'BTCUSDT',
    tickSize: 1,
    onSnapshot: (s) => snaps.push(s),
    onCandleClosed: () => {},
    onStatus: () => {},
    snapshotIntervalMs,
    socketCtor: () => new NullSocket(),
    rafScheduler: (cb) => {
      pendingRaf = cb;
    },
    now: () => nowMs,
  });
  return {
    mgr,
    snaps,
    setNow: (t) => {
      nowMs = t;
    },
    runRaf: () => {
      const cb = pendingRaf;
      pendingRaf = null;
      cb?.();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('liveCandleManager throttle', () => {
  it('первый тик в окне эмитит snapshot сразу', () => {
    const h = makeHarness();
    h.setNow(1000);
    h.mgr.applyTick(tick(1, 100));
    h.runRaf();
    expect(h.snaps).toHaveLength(1);
    expect(h.snaps[0]?.openCandle?.close).toBe(100);
  });

  it('подряд внутри окна эмитит только один snapshot (trailing emit на хвост окна)', () => {
    const h = makeHarness(250);
    h.setNow(1000);
    h.mgr.applyTick(tick(1, 100));
    h.runRaf();
    expect(h.snaps).toHaveLength(1);

    // Через 50мс прилетел второй тик — внутри окна, не должен эмитить
    // мгновенно, но обязан запланировать trailing на конец окна.
    h.setNow(1050);
    h.mgr.applyTick(tick(2, 101));
    h.runRaf();
    expect(h.snaps).toHaveLength(1);

    // Прокручиваем таймер на оставшиеся ~200мс окна.
    h.setNow(1250);
    vi.advanceTimersByTime(200);
    expect(h.snaps).toHaveLength(2);
    expect(h.snaps[1]?.openCandle?.close).toBe(101);
  });

  it('тик после окна эмитит сразу (не накапливая лишний таймер)', () => {
    const h = makeHarness(250);
    h.setNow(1000);
    h.mgr.applyTick(tick(1, 100));
    h.runRaf();
    h.setNow(1500);
    h.mgr.applyTick(tick(2, 102));
    h.runRaf();
    expect(h.snaps).toHaveLength(2);
  });

  it('закрытие 5m свечи форсит emit мгновенно, минуя throttle', () => {
    const h = makeHarness(1000);
    // Стартуем с now=10000, чтобы первый emit прошёл (elapsed=10000 ≥ 1000).
    h.setNow(10000);
    h.mgr.applyTick(tick(1, 100, false, 0));
    h.runRaf();
    expect(h.snaps).toHaveLength(1);

    // Через 50мс — обычный тик в той же 5m-свече, throttle должен задержать.
    h.setNow(10050);
    h.mgr.applyTick(tick(2, 101, false, 50));
    h.runRaf();
    expect(h.snaps).toHaveLength(1);

    // Тик в новом 5m-слоте → close + open. Эмит должен быть мгновенным,
    // несмотря на то что throttle-окно ещё не истекло.
    h.setNow(10060);
    h.mgr.applyTick(tick(3, 200, false, FIVE_MIN_MS + 1000));
    h.runRaf();
    expect(h.snaps.length).toBeGreaterThanOrEqual(2);
    const last = h.snaps[h.snaps.length - 1]!;
    expect(last.closedCandles).toHaveLength(1);
    expect(last.closedCandles[0]?.close).toBe(101);
    expect(last.openCandle?.close).toBe(200);
  });

  it('snapshotIntervalMs=0 → нет throttle, каждый flush эмитит сразу', () => {
    const h = makeHarness(0);
    h.setNow(0);
    h.mgr.applyTick(tick(1, 100));
    h.runRaf();
    h.setNow(1);
    h.mgr.applyTick(tick(2, 101));
    h.runRaf();
    h.setNow(2);
    h.mgr.applyTick(tick(3, 102));
    h.runRaf();
    expect(h.snaps).toHaveLength(3);
  });
});
