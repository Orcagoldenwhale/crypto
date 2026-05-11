/**
 * Точка входа SMC-анализатора.
 *
 * Один публичный вызов `runSmcAnalysis(candles, layers, options)` запускает
 * только включённые слои и возвращает агрегированный `SmcOverlay`. Это даёт
 * один-единственный useMemo в App, чтобы не пересчитывать при тогглах,
 * не относящихся к SMC.
 */

import type { Candle1h, Candle15m, Candle5m } from '@/types';
import { findFVGs } from './detectFvg';
import { findLiquidityZones } from './detectLiquidity';
import { detectStructure } from './detectStructure';
import { detectOrderBlocks } from './detectOrderBlocks';
import { detectBreakerBlocks } from './detectBreakerBlocks';
import { detectRejectionBlocks } from './detectRejectionBlocks';
import {
  EMPTY_SMC_OVERLAY,
  type SmcLayers,
  type SmcOptions,
  type SmcOverlay,
} from './types';

export function runSmcAnalysis(
  candles: readonly (Candle1h | Candle15m | Candle5m)[],
  layers: SmcLayers,
  options: SmcOptions,
): SmcOverlay {
  if (candles.length === 0) return EMPTY_SMC_OVERLAY;
  if (
    !layers.fvg &&
    !layers.liquidity &&
    !layers.structure &&
    !layers.orderBlocks &&
    !layers.breakerBlocks &&
    !layers.rejectionBlocks
  ) {
    return EMPTY_SMC_OVERLAY;
  }

  const hide = options.hideMitigated;

  // FVG: фильтр прокидываем прямо в детектор — он умеет отсеивать mitigated
  // зоны на этапе сборки, без постобработки.
  const fvgs = layers.fvg
    ? findFVGs(candles, { hideMitigated: hide.fvg, maxFillPct: options.fvgMaxFillPct, minFvgPct: options.minFvgPct })
    : [];

  // Liquidity: после детекта прячем уже снятые (sweep случился).
  const liquidityRaw = layers.liquidity
    ? findLiquidityZones(candles, {
        lookback: options.lookback,
        equalityTolerancePct: options.equalityTolerancePct,
      })
    : [];
  const liquidity = hide.liquidity
    ? liquidityRaw.filter((l) => l.sweep === null)
    : liquidityRaw;

  // OB зависит от структуры: если пользователь скрыл слой structure, но
  // просит OB — мы всё равно считаем breaks, просто не отдаём их в overlay.
  // BB также требует и breaks, и OB.
  const needsBreaks = layers.structure || layers.orderBlocks || layers.breakerBlocks;
  const allBreaks = needsBreaks
    ? detectStructure(candles, { lookback: options.lookback })
    : [];

  // Structure: прячем уже ретестнутые break'и — сетап считаем отработанным.
  const structureRaw = layers.structure ? allBreaks : [];
  const structure = hide.structure
    ? structureRaw.filter((s) => s.retestTime === null)
    : structureRaw;

  // OB всегда считаем если нужен сам слой ИЛИ нужны BB (они строятся из OB).
  const needsOb = layers.orderBlocks || layers.breakerBlocks;
  const orderBlocksRaw = needsOb
    ? detectOrderBlocks(candles, allBreaks, {
        extraction: options.obExtraction,
        useMeanThreshold: options.obUseMeanThreshold,
        requireAbsorption: options.obRequireAbsorption,
      })
    : [];
  const orderBlocks = layers.orderBlocks
    ? hide.orderBlocks
      ? orderBlocksRaw.filter((ob) => ob.unmitigated)
      : orderBlocksRaw
    : [];

  const breakerBlocksRaw = layers.breakerBlocks
    ? detectBreakerBlocks(candles, orderBlocksRaw, allBreaks)
    : [];
  const breakerBlocks = hide.breakerBlocks
    ? breakerBlocksRaw.filter((bb) => bb.unmitigated)
    : breakerBlocksRaw;

  // RB опирается на liquidity (нужны swing-точки для sweep-проверки).
  // Если слой liquidity выключен, но RB требует sweep — считаем
  // ликвидность отдельно для нужд RB.
  const liquidityForRb = layers.rejectionBlocks && !layers.liquidity
    ? findLiquidityZones(candles, {
        lookback: options.lookback,
        equalityTolerancePct: options.equalityTolerancePct,
      })
    : liquidityRaw;
  const rejectionBlocksRaw = layers.rejectionBlocks
    ? detectRejectionBlocks(candles, liquidityForRb, {
        wickRatio: options.rbWickRatio,
        requireSweep: options.rbRequireSweep,
      })
    : [];
  const rejectionBlocks = hide.rejectionBlocks
    ? rejectionBlocksRaw.filter((rb) => rb.unmitigated)
    : rejectionBlocksRaw;

  return { fvgs, liquidity, structure, orderBlocks, breakerBlocks, rejectionBlocks };
}

export * from './types';
export { findFVGs } from './detectFvg';
export { findLiquidityZones } from './detectLiquidity';
export { detectStructure } from './detectStructure';
export { detectOrderBlocks } from './detectOrderBlocks';
export { detectBreakerBlocks } from './detectBreakerBlocks';
export { detectRejectionBlocks } from './detectRejectionBlocks';
export { renderSmcOverlay } from './render';
