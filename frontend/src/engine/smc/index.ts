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
  if (!layers.fvg && !layers.liquidity) return EMPTY_SMC_OVERLAY;

  const fvgs = layers.fvg
    ? findFVGs(candles, { hideMitigated: options.hideMitigatedFvg })
    : [];

  const liquidity = layers.liquidity
    ? findLiquidityZones(candles, {
        lookback: options.lookback,
        equalityTolerancePct: options.equalityTolerancePct,
      })
    : [];

  return { fvgs, liquidity };
}

export * from './types';
export { findFVGs } from './detectFvg';
export { findLiquidityZones } from './detectLiquidity';
export { renderSmcOverlay } from './render';
