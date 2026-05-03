/**
 * Сохранение выбранной пары TF (старший → младший) в localStorage.
 */

import type { TfPairId } from '@/types';
import { DEFAULT_TF_PAIR, TF_PAIR_OPTIONS, parseTfPair } from '@/data/tfPairs';

const KEY = 'smc:tfPair';

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
    /* private mode */
  }
}

/** Возвращает сохранённую пару или default (15m→5m). */
export function loadTfPairId(): TfPairId {
  const raw = safeGet(KEY);
  const id = parseTfPair(raw ?? '');
  if (id) return id;
  return DEFAULT_TF_PAIR;
}

export function saveTfPairId(id: TfPairId): void {
  if (!TF_PAIR_OPTIONS.some((o) => o.id === id)) return;
  safeSet(KEY, id);
}
