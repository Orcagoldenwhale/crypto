/**
 * Сохранение настроек SMC-индикатора в localStorage:
 *   - smc:layers — { fvg: bool, liquidity: bool }
 *   - smc:opts   — { lookback: number, equalityTolerancePct: number, hideMitigatedFvg: bool }
 *
 * Любая ошибка чтения/записи (приватный режим, переполнение и т.п.) не должна
 * валить приложение — поэтому всё обёрнуто в try/catch.
 */

import {
  DEFAULT_SMC_LAYERS,
  DEFAULT_SMC_OPTIONS,
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
  const obj = data as Partial<SmcOptions>;
  return {
    lookback: clampInt(obj.lookback, 2, 50, DEFAULT_SMC_OPTIONS.lookback),
    equalityTolerancePct: clampNum(
      obj.equalityTolerancePct,
      0,
      0.05,
      DEFAULT_SMC_OPTIONS.equalityTolerancePct,
    ),
    hideMitigatedFvg:
      typeof obj.hideMitigatedFvg === 'boolean'
        ? obj.hideMitigatedFvg
        : DEFAULT_SMC_OPTIONS.hideMitigatedFvg,
  };
}

export function saveSmcOptions(opts: SmcOptions): void {
  safeSet(OPTS_KEY, JSON.stringify(opts));
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
