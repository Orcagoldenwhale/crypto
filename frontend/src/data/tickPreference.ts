/**
 * Persistence для пользовательских настроек: символ + tick preference.
 *
 * Используем localStorage (не IndexedDB) — это эфемерные настройки UI,
 * не данные. При повреждении или отсутствии — тихо откатываемся к default.
 */

import {
  TICK_MULTIPLIER_VALUES,
  type TickMultiplier,
} from '@/engine/regroupClusters';
import { DEFAULT_SYMBOL_ID, isKnownSymbol } from './symbols';

const KEY_SYMBOL = 'smc:symbol';
const KEY_TICK = 'smc:tickPref';

/**
 * Tick preference имеет два режима:
 *   - 'auto'    — multiplier вычисляется по плотности кластеров загруженного датасета;
 *   - { manual: N } — фиксированный множитель из {1, 2, 5, 10}.
 */
export type TickPref = 'auto' | { manual: TickMultiplier };

export const DEFAULT_TICK_PREF: TickPref = 'auto';

/** Безопасное чтение localStorage (приватное окно, ssr и т.п. могут кидать). */
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
    /* приватный режим — забиваем */
  }
}

export function loadSymbol(): string {
  const raw = safeGet(KEY_SYMBOL);
  if (raw && isKnownSymbol(raw)) return raw;
  return DEFAULT_SYMBOL_ID;
}

export function saveSymbol(symbol: string): void {
  if (!isKnownSymbol(symbol)) return;
  safeSet(KEY_SYMBOL, symbol);
}

export function loadTickPref(): TickPref {
  const raw = safeGet(KEY_TICK);
  if (!raw) return DEFAULT_TICK_PREF;
  if (raw === 'auto') return 'auto';
  // Формат: 'manual:N', где N ∈ TICK_MULTIPLIER_VALUES.
  const m = /^manual:(\d+)$/.exec(raw);
  if (!m) return DEFAULT_TICK_PREF;
  const n = Number(m[1]);
  if ((TICK_MULTIPLIER_VALUES as readonly number[]).includes(n)) {
    return { manual: n as TickMultiplier };
  }
  return DEFAULT_TICK_PREF;
}

export function saveTickPref(pref: TickPref): void {
  if (pref === 'auto') {
    safeSet(KEY_TICK, 'auto');
    return;
  }
  safeSet(KEY_TICK, `manual:${pref.manual}`);
}

/** Хелпер для UI: текстовый лейбл для tick preference. */
export function tickPrefLabel(pref: TickPref, effective: TickMultiplier): string {
  if (pref === 'auto') return `авто · ×${effective}`;
  return `×${pref.manual}`;
}
