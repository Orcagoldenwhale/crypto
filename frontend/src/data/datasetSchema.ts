/**
 * Zod-схема для Dataset, выгружаемого Python-pipeline (data-pipeline/).
 *
 * ВАЖНО: должна 1:1 соответствовать `data-pipeline/src/smc_data/schema.py`.
 * Любое расхождение → пользователь увидит понятную ошибку валидации.
 *
 * Инварианты, проверяемые на стороне Python (vol = bid+ask, сортировка кластеров,
 * timestamp кратен 5m и т.д.), здесь дублируются в `superRefine`, чтобы поймать
 * случайные ручные правки JSON.
 */

import { z } from 'zod';
import type { Dataset } from '@/types';

const FIVE_MIN_MS = 5 * 60 * 1000;
const TOLERANCE = 1e-6;

// ============================================================================
// Cluster
// ============================================================================

const clusterSchema = z
  .object({
    price: z.number().nonnegative(),
    bid: z.number().nonnegative(),
    ask: z.number().nonnegative(),
    vol: z.number().nonnegative(),
    delta: z.number(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (Math.abs(c.vol - (c.bid + c.ask)) > TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `vol=${c.vol} ≠ bid+ask=${c.bid + c.ask}`,
        path: ['vol'],
      });
    }
    if (Math.abs(c.delta - (c.ask - c.bid)) > TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `delta=${c.delta} ≠ ask−bid=${c.ask - c.bid}`,
        path: ['delta'],
      });
    }
  });

// ============================================================================
// Candle5m
// ============================================================================

const candle5mSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    open: z.number().nonnegative(),
    high: z.number().nonnegative(),
    low: z.number().nonnegative(),
    close: z.number().nonnegative(),
    volume: z.number().nonnegative(),
    delta: z.number(),
    vpoc_price: z.number().nonnegative(),
    max_vol: z.number().nonnegative(),
    delta_at_low: z.number(),
    delta_at_high: z.number(),
    clusters: z.array(clusterSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.timestamp % FIVE_MIN_MS !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `timestamp=${c.timestamp} не кратен 5m`,
        path: ['timestamp'],
      });
    }
    if (c.high < Math.max(c.open, c.close, c.low)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `high=${c.high} ниже одного из OCL`,
        path: ['high'],
      });
    }
    if (c.low > Math.min(c.open, c.close, c.high)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `low=${c.low} выше одного из OCH`,
        path: ['low'],
      });
    }
    if (c.clusters.length === 0) return;

    // Кластеры отсортированы по price.
    const prices = c.clusters.map((cl) => cl.price);
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1] ?? 0;
      const curr = prices[i] ?? 0;
      if (curr <= prev) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `clusters не отсортированы / есть дубли: prev=${prev}, curr=${curr} (i=${i})`,
          path: ['clusters'],
        });
        break;
      }
    }

    // Σ vol == volume; Σ delta == delta.
    const sumVol = c.clusters.reduce((s, x) => s + x.vol, 0);
    const sumDelta = c.clusters.reduce((s, x) => s + x.delta, 0);
    if (Math.abs(sumVol - c.volume) > TOLERANCE * Math.max(1, sumVol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `volume=${c.volume} ≠ Σ cluster.vol=${sumVol}`,
        path: ['volume'],
      });
    }
    if (Math.abs(sumDelta - c.delta) > TOLERANCE * Math.max(1, Math.abs(sumDelta) + 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `delta=${c.delta} ≠ Σ cluster.delta=${sumDelta}`,
        path: ['delta'],
      });
    }

    // VPOC = кластер с max vol.
    let max = c.clusters[0]!;
    for (const cl of c.clusters) if (cl.vol > max.vol) max = cl;
    if (Math.abs(max.vol - c.max_vol) > TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `max_vol=${c.max_vol} ≠ vol VPOC=${max.vol}`,
        path: ['max_vol'],
      });
    }
    if (Math.abs(max.price - c.vpoc_price) > TOLERANCE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `vpoc_price=${c.vpoc_price} ≠ price VPOC=${max.price}`,
        path: ['vpoc_price'],
      });
    }
  });

// ============================================================================
// Meta + Dataset
// ============================================================================

const datasetMetaSchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9]+$/, 'symbol должен быть UPPERCASE'),
    exchange: z.string().min(1).default('binance'),
    timeframe: z.literal('5m'),
    tick_size: z.number().positive(),
    from: z.string().min(1),
    to: z.string().min(1),
    candles_count: z.number().int().nonnegative(),
    generated_at: z.string().min(1),
    source: z.string().min(1).default('binance-vision-aggTrades'),
    version: z.number().int().default(1),
  })
  .strict();

export const datasetSchema = z
  .object({
    meta: datasetMetaSchema,
    candles: z.array(candle5mSchema),
  })
  .strict()
  .superRefine((ds, ctx) => {
    if (ds.meta.candles_count !== ds.candles.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `meta.candles_count=${ds.meta.candles_count} ≠ candles.length=${ds.candles.length}`,
        path: ['meta', 'candles_count'],
      });
    }
    // Свечи отсортированы по timestamp и без дублей.
    for (let i = 1; i < ds.candles.length; i++) {
      const prev = ds.candles[i - 1]!.timestamp;
      const curr = ds.candles[i]!.timestamp;
      if (curr <= prev) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `candles не отсортированы / дубли по timestamp: prev=${prev}, curr=${curr} (i=${i})`,
          path: ['candles'],
        });
        break;
      }
    }
  });

// ============================================================================
// Парсинг + типизация выхода
// ============================================================================

/**
 * Распарсить и провалидировать JSON-датасет.
 *
 * Бросает `ZodError` с понятным описанием при любых нарушениях.
 * На успехе — возвращает `Dataset` (типы из `@/types`), безопасный к использованию.
 */
export function parseDatasetJson(raw: string): Dataset {
  const obj: unknown = JSON.parse(raw);
  const parsed = datasetSchema.parse(obj);
  // `parsed` структурно совместим с `Dataset` (timeframe='5m', все поля совпадают).
  return parsed as Dataset;
}

/** То же, но без бросков — удобно для UI: { ok:true, data } | { ok:false, error }. */
export function safeParseDatasetJson(
  raw: string,
):
  | { ok: true; data: Dataset }
  | { ok: false; error: string } {
  try {
    const obj: unknown = JSON.parse(raw);
    const result = datasetSchema.safeParse(obj);
    if (result.success) {
      return { ok: true, data: result.data as Dataset };
    }
    return { ok: false, error: formatZodError(result.error) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `JSON parse error: ${msg}` };
  }
}

/** Компактное описание ошибки валидации — первые 3 проблемы. */
function formatZodError(err: z.ZodError): string {
  const issues = err.issues.slice(0, 3).map((i) => {
    const path = i.path.length > 0 ? `${i.path.join('.')}: ` : '';
    return `${path}${i.message}`;
  });
  const more = err.issues.length > 3 ? ` (+${err.issues.length - 3} more)` : '';
  return issues.join('; ') + more;
}
