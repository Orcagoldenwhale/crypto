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

  // FVG: hideMitigated прокидываем в детектор — там зоны фильтруются ещё на
  // этапе сборки, без лишней постобработки.
  const fvgs = layers.fvg
    ? findFVGs(candles, { hideMitigated: hide })
    : [];

  // Liquidity: фильтруем после детекта — детектор сам отдаёт sweep/без sweep.
  const liquidityRaw = layers.liquidity
    ? findLiquidityZones(candles, {
        lookback: options.lookback,
        equalityTolerancePct: options.equalityTolerancePct,
      })
    : [];
  const liquidity = hide
    ? liquidityRaw.filter((l) => l.sweep === null)
    : liquidityRaw;

  // OB зависит от структуры: если пользователь скрыл structure, но просит
  // OB — мы всё равно считаем breaks (нужны для алгоритма), просто не
  // отдаём их в overlay.
  const needsBreaks = layers.structure || layers.orderBlocks;
  const allBreaks = needsBreaks
    ? detectStructure(candles, { lookback: options.lookback })
    : [];

  // Structure: при включённом hide прячем уже «протестированные» break'и
  // (retest состоялся — сетап считаем отработанным).
  const structureRaw = layers.structure ? allBreaks : [];
  const structure = hide
    ? structureRaw.filter((s) => s.retestTime === null)
    : structureRaw;

  const orderBlocksRaw = layers.orderBlocks
    ? detectOrderBlocks(candles, allBreaks)
    : [];
  const orderBlocks = hide
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
