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
import { detectPrevDayLevels } from './detectPrevDayLevels';
import { detectCompressionZones } from './detectCompression';
import {
  EMPTY_SMC_OVERLAY,
  type LiquidityZone,
  type SmcLayers,
  type SmcOptions,
  type SmcOverlay,
  type StructureBreak,
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
    !layers.rejectionBlocks &&
    !options.liqShowPrevDay &&
    !options.liqShowCompression
  ) {
    return EMPTY_SMC_OVERLAY;
  }

  const hide = options.hideMitigated;

  // FVG: фильтр прокидываем прямо в детектор — он умеет отсеивать mitigated
  // зоны на этапе сборки, без постобработки.
  const fvgs = layers.fvg
    ? findFVGs(candles, { hideMitigated: hide.fvg, maxFillPct: options.fvgMaxFillPct, minFvgPct: options.minFvgPct })
    : [];

  // Сначала структура (breaks) — нужна для классификации liquidity
  // и для OB/BB. Считаем всегда если что-то из зависимых слоёв включено.
  const needsBreaks =
    layers.structure || layers.orderBlocks || layers.breakerBlocks || layers.liquidity;
  const allBreaks = needsBreaks
    ? detectStructure(candles, { lookback: options.lookback })
    : [];

  // Liquidity: сначала детект, затем классификация internal/external,
  // затем фильтр по toggle, затем hideMitigated.
  const liquidityRaw = layers.liquidity
    ? findLiquidityZones(candles, {
        lookback: options.lookback,
        equalityTolerancePct: options.equalityTolerancePct,
      })
    : [];
  const liquidityClassified = classifyLiquidityPosition(liquidityRaw, allBreaks);
  let liquidity = liquidityClassified.filter((l) => {
    if (l.position === 'external' && !options.liqShowExternal) return false;
    if (l.position === 'internal' && !options.liqShowInternal) return false;
    return true;
  });
  if (hide.liquidity) liquidity = liquidity.filter((l) => l.sweep === null);

  // Structure: прячем уже ретестнутые break'и — сетап считаем отработанным.
  const structureRaw = layers.structure ? allBreaks : [];
  const structure = hide.structure
    ? structureRaw.filter((s) => s.retestTime === null)
    : structureRaw;

  // OB всегда считаем если нужен сам слой ИЛИ нужны BB (они строятся из OB).
  const needsOb = layers.orderBlocks || layers.breakerBlocks;
  // Для аддитивных контекстов searchAtSweep / searchAtFvg нужны зоны
  // ликвидности и FVG. Если соответствующие слои выключены — считаем
  // их отдельно (на лету). Это короткий вычислительный путь.
  const liquidityForOb = needsOb && options.obSearchAtSweep
    ? (liquidityRaw.length > 0 ? liquidityRaw : findLiquidityZones(candles, {
        lookback: options.lookback,
        equalityTolerancePct: options.equalityTolerancePct,
      }))
    : liquidityRaw;
  const fvgForOb = needsOb && options.obSearchAtFvg
    ? (fvgs.length > 0 ? fvgs : findFVGs(candles, {
        maxFillPct: options.fvgMaxFillPct,
        minFvgPct: options.minFvgPct,
      }))
    : fvgs;
  const orderBlocksRaw = needsOb
    ? detectOrderBlocks(candles, allBreaks, {
        extraction: options.obExtraction,
        useMeanThreshold: options.obUseMeanThreshold,
        mtIncludeWicks: options.obMtIncludeWicks,
        requireAbsorption: options.obRequireAbsorption,
        allowMultiCandle: options.obAllowMultiCandle,
        multiCandleMax: options.obMultiCandleMax,
        searchAtSweep: options.obSearchAtSweep,
        searchAtFvg: options.obSearchAtFvg,
        searchAtPrevBlock: options.obSearchAtPrevBlock,
        liquidityZones: liquidityForOb,
        fvgZones: fvgForOb,
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
  // FVG для RB-контекста — на лету если слой FVG выключен, но опция
  // rbAlsoAtFvg включена.
  const fvgForRb = layers.rejectionBlocks && options.rbAlsoAtFvg
    ? (fvgs.length > 0 ? fvgs : findFVGs(candles, {
        maxFillPct: options.fvgMaxFillPct,
        minFvgPct: options.minFvgPct,
      }))
    : fvgs;
  // Для контекста "wick зашёл в предыдущий OB" нужны уже найденные OB/BB.
  const priorBlocksForRb = layers.rejectionBlocks && options.rbAlsoAtPrevBlock
    ? [...orderBlocksRaw, ...breakerBlocksRaw.map((bb) => ({
        // BreakerBlockZone → форма OrderBlockZone (нужны только поля
        // что использует wickEntersPrevBlock: startTime, minPrice, maxPrice).
        id: bb.id,
        kind: bb.kind,
        obTime: bb.obTime,
        startTime: bb.startTime,
        endTime: bb.endTime,
        minPrice: bb.minPrice,
        maxPrice: bb.maxPrice,
        mtPrice: bb.mtPrice,
        openPrice: bb.openPrice,
        hasFvg: false,
        unmitigated: bb.unmitigated,
        breakKind: 'BOS' as const,
      }))]
    : [];
  const rejectionBlocksRaw = layers.rejectionBlocks
    ? detectRejectionBlocks(candles, liquidityForRb, {
        wickRatio: options.rbWickRatio,
        requireSweep: options.rbRequireSweep,
        alsoAtFvg: options.rbAlsoAtFvg,
        alsoAtPrevBlock: options.rbAlsoAtPrevBlock,
        useMeanThreshold: options.rbUseMeanThreshold,
        mtIncludeWicks: options.rbMtIncludeWicks,
        fvgZones: fvgForRb,
        priorBlocks: priorBlocksForRb,
      })
    : [];
  const rejectionBlocks = hide.rejectionBlocks
    ? rejectionBlocksRaw.filter((rb) => rb.unmitigated)
    : rejectionBlocksRaw;

  // Previous Day High/Low — отдельный слой, управляется liqShowPrevDay.
  const prevDayLevelsRaw = options.liqShowPrevDay
    ? detectPrevDayLevels(candles)
    : [];
  const prevDayLevels = hide.liquidity
    ? prevDayLevelsRaw.filter((p) => p.unmitigated)
    : prevDayLevelsRaw;

  // Compression — серии swing-точек в корректирующих движениях.
  const compressions = options.liqShowCompression
    ? detectCompressionZones(candles, {
        lookback: options.lookback,
        minPoints: options.liqCompressionMinPoints,
      })
    : [];

  return { fvgs, liquidity, structure, orderBlocks, breakerBlocks, rejectionBlocks, prevDayLevels, compressions };
}

/**
 * Помечает каждую liquidity-зону как internal/external относительно
 * последнего структурного диапазона.
 *
 * Определяем "последний range" как: цена swing-точки последнего пробоя
 * (levelTime) и противоположный экстремум среди break'ов. Упрощённо:
 *   - если уровень ВЫШЕ всех level из breaks → external (high)
 *   - если уровень НИЖЕ всех level из breaks → external (low)
 *   - иначе → internal.
 *
 * Если breaks пустой — все уровни external (нет структуры для сравнения).
 */
function classifyLiquidityPosition(
  zones: readonly LiquidityZone[],
  breaks: readonly StructureBreak[],
): LiquidityZone[] {
  if (zones.length === 0) return [];
  if (breaks.length === 0) {
    return zones.map((z) => ({ ...z, position: 'external' as const }));
  }
  let maxLevel = -Infinity;
  let minLevel = Infinity;
  for (const b of breaks) {
    if (b.level > maxLevel) maxLevel = b.level;
    if (b.level < minLevel) minLevel = b.level;
  }
  return zones.map((z) => {
    let position: LiquidityZone['position'];
    if (z.kind === 'high') {
      position = z.price >= maxLevel ? 'external' : 'internal';
    } else {
      position = z.price <= minLevel ? 'external' : 'internal';
    }
    return { ...z, position };
  });
}

export * from './types';
export { findFVGs } from './detectFvg';
export { findLiquidityZones } from './detectLiquidity';
export { detectStructure } from './detectStructure';
export { detectOrderBlocks } from './detectOrderBlocks';
export { detectBreakerBlocks } from './detectBreakerBlocks';
export { detectRejectionBlocks } from './detectRejectionBlocks';
export { detectPrevDayLevels } from './detectPrevDayLevels';
export { detectCompressionZones } from './detectCompression';
export { renderSmcOverlay } from './render';
