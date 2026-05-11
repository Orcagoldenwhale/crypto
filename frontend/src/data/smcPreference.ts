/**
 * Сохранение настроек SMC-индикатора в localStorage:
 *   - smc:layers — { fvg, liquidity, structure, orderBlocks: bool }
 *   - smc:opts   — { lookback: number, equalityTolerancePct: number,
 *                    hideMitigated: { fvg, liquidity, structure, orderBlocks: bool } }
 *
 * Любая ошибка чтения/записи (приватный режим, переполнение и т.п.) не должна
 * валить приложение — поэтому всё обёрнуто в try/catch.
 *
 * Бэкомпат двух поколений (поле `hideMitigated` могло быть):
 *   v1 — `hideMitigatedFvg: boolean` (до глобального фильтра)
 *        → переносим в `hideMitigated.fvg`, остальные слои false;
 *   v2 — `hideMitigated: boolean` (общий фильтр для всех слоёв)
 *        → копируем в `hideMitigated.{fvg, liquidity, structure, orderBlocks}`.
 *
 * Поэтому пользователь не теряет свой выбор после апдейта схемы.
 */

import {
  DEFAULT_HIDE_MITIGATED,
  DEFAULT_SMC_LAYERS,
  DEFAULT_SMC_OPTIONS,
  type SmcHideMitigated,
  type SmcLayers,
  type SmcOptions,
} from '@/engine/smc/types';

const LAYERS_KEY = 'smc:layers';
const OPTS_KEY = 'smc:opts';

// ============================================================================
// Низкоуровневые safe-обёртки
// ============================================================================

function safeGet(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ============================================================================
// SmcLayers
// ============================================================================

export function loadSmcLayers(): SmcLayers {
  const data = safeParse(safeGet(LAYERS_KEY));
  if (!data || typeof data !== 'object') return DEFAULT_SMC_LAYERS;
  const obj = data as Partial<SmcLayers>;
  return {
    fvg: typeof obj.fvg === 'boolean' ? obj.fvg : DEFAULT_SMC_LAYERS.fvg,
    liquidity:
      typeof obj.liquidity === 'boolean'
        ? obj.liquidity
        : DEFAULT_SMC_LAYERS.liquidity,
    structure:
      typeof obj.structure === 'boolean'
        ? obj.structure
        : DEFAULT_SMC_LAYERS.structure,
    orderBlocks:
      typeof obj.orderBlocks === 'boolean'
        ? obj.orderBlocks
        : DEFAULT_SMC_LAYERS.orderBlocks,
  };
}

export function saveSmcLayers(layers: SmcLayers): void {
  safeSet(LAYERS_KEY, JSON.stringify(layers));
}

// ============================================================================
// SmcOptions
// ============================================================================

export function loadSmcOptions(): SmcOptions {
  const data = safeParse(safeGet(OPTS_KEY));
  if (!data || typeof data !== 'object') return DEFAULT_SMC_OPTIONS;
  // Расширенный partial-тип: hideMitigated может быть объектом (актуальная
  // схема), boolean'ом (предыдущая глобальная версия) или вообще отсутствовать.
  // Плюс legacy поле hideMitigatedFvg из самой первой версии.
  const obj = data as Omit<Partial<SmcOptions>, 'hideMitigated'> & {
    hideMitigated?: unknown;
    hideMitigatedFvg?: unknown;
  };
  return {
    lookback: clampInt(obj.lookback, 2, 50, DEFAULT_SMC_OPTIONS.lookback),
    equalityTolerancePct: clampNum(
      obj.equalityTolerancePct,
      0,
      0.05,
      DEFAULT_SMC_OPTIONS.equalityTolerancePct,
    ),
    hideMitigated: parseHideMitigated(obj.hideMitigated, obj.hideMitigatedFvg),
    fvgMaxFillPct: clampInt(
      obj.fvgMaxFillPct,
      0,
      100,
      DEFAULT_SMC_OPTIONS.fvgMaxFillPct,
    ),
    minFvgPct: clampNum(
      obj.minFvgPct,
      0,
      5,
      DEFAULT_SMC_OPTIONS.minFvgPct,
    ),
    obExtraction: parseObExtraction(obj.obExtraction),
    obUseMeanThreshold:
      typeof obj.obUseMeanThreshold === 'boolean'
        ? obj.obUseMeanThreshold
        : DEFAULT_SMC_OPTIONS.obUseMeanThreshold,
    obRequireAbsorption:
      typeof obj.obRequireAbsorption === 'boolean'
        ? obj.obRequireAbsorption
        : DEFAULT_SMC_OPTIONS.obRequireAbsorption,
  };
}

/**
 * Парсинг `hideMitigated` с учётом всех исторических форматов.
 * `unknown` на входе — потому что это сырые данные из localStorage.
 */
function parseHideMitigated(
  raw: unknown,
  legacyFvg: unknown,
): SmcHideMitigated {
  if (raw && typeof raw === 'object') {
    const o = raw as Partial<SmcHideMitigated>;
    return {
      fvg: typeof o.fvg === 'boolean' ? o.fvg : DEFAULT_HIDE_MITIGATED.fvg,
      liquidity:
        typeof o.liquidity === 'boolean'
          ? o.liquidity
          : DEFAULT_HIDE_MITIGATED.liquidity,
      structure:
        typeof o.structure === 'boolean'
          ? o.structure
          : DEFAULT_HIDE_MITIGATED.structure,
      orderBlocks:
        typeof o.orderBlocks === 'boolean'
          ? o.orderBlocks
          : DEFAULT_HIDE_MITIGATED.orderBlocks,
    };
  }
  if (typeof raw === 'boolean') {
    // v2: глобальный флаг → раскопировать на все слои.
    return { fvg: raw, liquidity: raw, structure: raw, orderBlocks: raw };
  }
  if (typeof legacyFvg === 'boolean') {
    // v1: только FVG.
    return { ...DEFAULT_HIDE_MITIGATED, fvg: legacyFvg };
  }
  return { ...DEFAULT_HIDE_MITIGATED };
}

export function saveSmcOptions(opts: SmcOptions): void {
  safeSet(OPTS_KEY, JSON.stringify(opts));
}

function parseObExtraction(raw: unknown): SmcOptions['obExtraction'] {
  if (raw === 'body' || raw === 'wicks' || raw === 'auto') return raw;
  return DEFAULT_SMC_OPTIONS.obExtraction;
}

// ============================================================================
// Хелперы валидации
// ============================================================================

function clampInt(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const i = Math.round(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function clampNum(
  v: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
