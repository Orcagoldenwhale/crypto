/**
 * Детектор Rejection Block (RB) — свеча с длинным фитилём, снимающим
 * ликвидность.
 *
 * Из лекции: RB — это структурный экстремум с длинной тенью в направлении
 * движения цены, сформировавшейся при снятии ликвидности. Зона = сам фитиль
 * (не вся свеча), так как именно там сконцентрированы заявки.
 *
 * Критерии:
 *   bull-RB:
 *     - нижний фитиль ≥ wickRatio × тело свечи;
 *     - фитиль пробивает swing-low (sweep ликвидности) — опционально.
 *   bear-RB: зеркально для верхнего фитиля.
 *
 * Зона:
 *   bull-RB: [low, min(open, close)] — нижний фитиль
 *   bear-RB: [max(open, close), high] — верхний фитиль
 *
 * Mitigation: первое касание фитиля свечой после RB-свечи.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import type { LiquidityZone, RejectionBlockZone } from './types';

interface OhlcCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DetectRejectionBlocksOptions {
  /** Минимальное соотношение фитиля к телу. По умолчанию 2. */
  wickRatio?: number;
  /**
   * Требовать пересечение фитилём swing-точки из liquidityZones.
   * По умолчанию true.
   */
  requireSweep?: boolean;
}

export function detectRejectionBlocks(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  liquidityZones: readonly LiquidityZone[],
  options: DetectRejectionBlocksOptions = {},
): RejectionBlockZone[] {
  if (candles.length === 0) return [];
  const arr = candles as readonly OhlcCandle[];
  const lastTime = arr[arr.length - 1]!.timestamp;
  const wickRatio = options.wickRatio ?? 2;
  const requireSweep = options.requireSweep ?? true;
  const out: RejectionBlockZone[] = [];

  for (let i = 0; i < arr.length; i++) {
    const c = arr[i]!;
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    // Защита от деления на ноль и от свеч-доджи: тело должно быть > 0
    // (хотя бы 1 тик). Иначе пропускаем.
    if (body <= 0) continue;

    // Bull RB: нижний фитиль доминирует.
    if (lowerWick >= body * wickRatio && lowerWick > upperWick) {
      const minPrice = c.low;
      const maxPrice = Math.min(c.open, c.close);
      const hasSweep = checkLowSweep(c, liquidityZones);
      if (requireSweep && !hasSweep) continue;
      const mtPrice = (minPrice + maxPrice) / 2;
      const mit = findMitigation(arr, i + 1, 'bull', minPrice, maxPrice);
      out.push({
        id: `rb-bull-${c.timestamp}`,
        kind: 'bull',
        obTime: c.timestamp,
        startTime: c.timestamp,
        endTime: mit !== null ? mit : lastTime,
        minPrice,
        maxPrice,
        mtPrice,
        hasSweep,
        unmitigated: mit === null,
      });
      continue;
    }

    // Bear RB: верхний фитиль доминирует.
    if (upperWick >= body * wickRatio && upperWick > lowerWick) {
      const minPrice = Math.max(c.open, c.close);
      const maxPrice = c.high;
      const hasSweep = checkHighSweep(c, liquidityZones);
      if (requireSweep && !hasSweep) continue;
      const mtPrice = (minPrice + maxPrice) / 2;
      const mit = findMitigation(arr, i + 1, 'bear', minPrice, maxPrice);
      out.push({
        id: `rb-bear-${c.timestamp}`,
        kind: 'bear',
        obTime: c.timestamp,
        startTime: c.timestamp,
        endTime: mit !== null ? mit : lastTime,
        minPrice,
        maxPrice,
        mtPrice,
        hasSweep,
        unmitigated: mit === null,
      });
    }
  }

  return out;
}

/**
 * Проверяет, прокололи ли мы swing-low (sell-side ликвидность):
 * среди ликвидных зон есть 'low' с price ≥ candle.low и price ≤ open/close
 * (т.е. фитиль свечи пересёк уровень).
 */
function checkLowSweep(
  candle: OhlcCandle,
  zones: readonly LiquidityZone[],
): boolean {
  const bodyBot = Math.min(candle.open, candle.close);
  for (const z of zones) {
    if (z.kind !== 'low') continue;
    // Зона активна до или во время этой свечи.
    if (z.startTime > candle.timestamp) continue;
    // Фитиль свечи прошёл сквозь уровень: low ≤ price ≤ bodyBot.
    if (candle.low <= z.price && z.price <= bodyBot) return true;
  }
  return false;
}

function checkHighSweep(
  candle: OhlcCandle,
  zones: readonly LiquidityZone[],
): boolean {
  const bodyTop = Math.max(candle.open, candle.close);
  for (const z of zones) {
    if (z.kind !== 'high') continue;
    if (z.startTime > candle.timestamp) continue;
    if (bodyTop <= z.price && z.price <= candle.high) return true;
  }
  return false;
}

function findMitigation(
  arr: readonly OhlcCandle[],
  from: number,
  kind: 'bull' | 'bear',
  minPrice: number,
  maxPrice: number,
): number | null {
  for (let k = from; k < arr.length; k++) {
    const c = arr[k]!;
    // bull RB (фитиль снизу): касание сверху, low ≤ maxPrice
    // bear RB (фитиль сверху): high ≥ minPrice
    if (kind === 'bull' ? c.low <= maxPrice : c.high >= minPrice) {
      return c.timestamp;
    }
  }
  return null;
}
