/**
 * Gap recovery: REST-подгрузка пропущенных aggTrades.
 *
 * Сценарии использования:
 *   1. После reconnect WebSocket — между разрывом и восстановлением мы могли
 *      пропустить часть тиков. Запрашиваем `fromId = lastSeenId + 1` и
 *      догоняем серию.
 *   2. После reload страницы — читаем lastAggTradeId из IDB, делаем тот же
 *      запрос. Если тиков очень много (часы оффлайна) — пагинация по 1000.
 *
 * Эндпоинт: GET /api/v3/aggTrades?symbol=BTCUSDT&fromId={id}&limit=1000
 * Документация: https://binance-docs.github.io/apidocs/spot/en/#old-trade-lookup
 *
 * Лимит 1000 (Binance) — выше нельзя. При полностью забитой странице
 * запрашиваем следующую с `fromId = last + 1`. Жёсткий cap MAX_PAGES
 * защищает от бесконечного цикла, если поток слишком быстрый.
 */

import type { AggTradeTick } from '@/types';

const DEFAULT_BASE_URL = 'https://api.binance.com/api/v3';
const PAGE_LIMIT = 1000;
/**
 * Жёсткий потолок страниц: 50 × 1000 = 50_000 тиков max за один gap.
 * Если поток быстрее — лучше «отказаться» и продолжить со стрима без догона
 * старых тиков (живой данные важнее восстановления прошлого).
 */
const MAX_PAGES = 50;

export interface GapFillerOptions {
  symbol: string;
  /** Берём тики начиная с aggTradeId = fromId. */
  fromId: number;
  /** Колбэк на каждую страницу — manager сразу применит и сдвинет lastId. */
  onPage: (ticks: AggTradeTick[]) => Promise<void> | void;
  /** Базовый URL REST API (для тестов). */
  baseUrl?: string | undefined;
  /** fetch для DI в тестах. */
  fetchImpl?: typeof fetch | undefined;
  /** Кастомный потолок страниц. */
  maxPages?: number | undefined;
  /** Логгер ошибок. */
  onError?: ((e: unknown) => void) | undefined;
}

export interface GapFillerResult {
  pages: number;
  totalTicks: number;
  /** ID последнего применённого тика (или fromId-1 если ничего не пришло). */
  lastAggTradeId: number;
}

/**
 * Догнать пропущенные тики и вернуть итог.
 *
 * Алгоритм:
 *   1. Пока не достигнут maxPages: GET aggTrades fromId=cursor.
 *   2. Если страница пуста → закончили, ничего не пропустили.
 *   3. Если страница полная (== PAGE_LIMIT) → сдвигаем cursor на last+1, ещё раз.
 *   4. Если страница неполная → закончили, всё догнали.
 *
 * Между страницами небольшая пауза, чтобы не упереться в rate-limit Binance
 * (1200 req/min на IP). 50 страниц × 50ms = 2.5 сек — нормально.
 */
export async function fillAggTradeGap(
  opts: GapFillerOptions,
): Promise<GapFillerResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const onError = opts.onError ?? ((e: unknown) => console.warn('[gap-filler]', e));

  let cursor = opts.fromId;
  let totalTicks = 0;
  let pages = 0;
  let lastAggTradeId = opts.fromId - 1;

  while (pages < maxPages) {
    const url = `${baseUrl}/aggTrades?symbol=${encodeURIComponent(
      opts.symbol,
    )}&fromId=${cursor}&limit=${PAGE_LIMIT}`;

    let raw: unknown;
    try {
      const resp = await fetchImpl(url);
      if (!resp.ok) {
        onError(new Error(`gap-filler HTTP ${resp.status}`));
        break;
      }
      raw = await resp.json();
    } catch (e) {
      onError(e);
      break;
    }

    const ticks = parseAggTradesArray(raw);
    pages += 1;
    if (ticks.length === 0) break;

    try {
      await opts.onPage(ticks);
    } catch (e) {
      onError(e);
      break;
    }

    totalTicks += ticks.length;
    lastAggTradeId = ticks[ticks.length - 1]!.aggTradeId;

    // Не полная страница — догнали.
    if (ticks.length < PAGE_LIMIT) break;

    cursor = lastAggTradeId + 1;
    // Лёгкая пауза между страницами (rate limit-friendly).
    await sleep(50);
  }

  return { pages, totalTicks, lastAggTradeId };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Распарсить ответ REST `/aggTrades` в массив AggTradeTick.
 *
 * Формат отличается от WS: поля называются `a/p/q/T/m`, цена и qty —
 * строки, isBuyerMaker → m. Невалидные элементы тихо пропускаются.
 */
export function parseAggTradesArray(raw: unknown): AggTradeTick[] {
  if (!Array.isArray(raw)) return [];
  const out: AggTradeTick[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
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
      continue;
    }
    out.push({ aggTradeId, price, qty, timestamp, isBuyerMaker });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
