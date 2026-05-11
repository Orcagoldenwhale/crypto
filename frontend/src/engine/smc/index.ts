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
    !layers.orderBlocks
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
  const needsBreaks = layers.structure || layers.orderBlocks;
  const allBreaks = needsBreaks
    ? detectStructure(candles, { lookback: options.lookback })
    : [];

  // Structure: прячем уже ретестнутые break'и — сетап считаем отработанным.
  const structureRaw = layers.structure ? allBreaks : [];
  const structure = hide.structure
    ? structureRaw.filter((s) => s.retestTime === null)
    : structureRaw;

  const orderBlocksRaw = layers.orderBlocks
    ? detectOrderBlocks(candles, allBreaks, {
        extraction: options.obExtraction,
        useMeanThreshold: options.obUseMeanThreshold,
        requireAbsorption: options.obRequireAbsorption,
      })
    : [];
  const orderBlocks = hide.orderBlocks
    ? orderBlocksRaw.filter((ob) => ob.unmitigated)
    : orderBlocksRaw;

  return { fvgs, liquidity, structure, orderBlocks };
}

export * from './types';
export { findFVGs } from './detectFvg';
export { findLiquidityZones } from './detectLiquidity';
export { detectStructure } from './detectStructure';
export { detectOrderBlocks } from './detectOrderBlocks';
export { renderSmcOverlay } from './render';
