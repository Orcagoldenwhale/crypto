import type { ChartTimeframe, TfPairId } from '@/types';

/** Варианты пар «старший → младший» (или single, когда HTF == LTF) для UI. */
export const TF_PAIR_OPTIONS: readonly { id: TfPairId; label: string; hint: string }[] = [
  { id: '1h-15m', label: '1h → 15m', hint: 'Зоны на часовом, входы на 15m' },
  { id: '1h-5m', label: '1h → 5m', hint: 'Зоны на часовом, входы на 5m' },
  { id: '15m-5m', label: '15m → 5m', hint: 'Классика: зоны на 15m, входы на 5m' },
  { id: '1h-1h', label: '1h (single)', hint: 'Один ТФ: зоны и входы на часовом' },
  { id: '15m-15m', label: '15m (single)', hint: 'Один ТФ: зоны и входы на 15m' },
  { id: '5m-5m', label: '5m (single)', hint: 'Один ТФ: зоны и входы на 5m' },
] as const;

export const DEFAULT_TF_PAIR: TfPairId = '15m-5m';

const ALL_IDS: readonly TfPairId[] = [
  '1h-15m',
  '1h-5m',
  '15m-5m',
  '1h-1h',
  '15m-15m',
  '5m-5m',
];

export function parseTfPair(id: string): TfPairId | null {
  return (ALL_IDS as readonly string[]).includes(id) ? (id as TfPairId) : null;
}

/**
 * Возвращает true, если пара использует один и тот же таймфрейм
 * для разметки и для сканера (single-режим).
 */
export function isSingleTfPair(id: TfPairId): boolean {
  return id === '1h-1h' || id === '15m-15m' || id === '5m-5m';
}

export function chartTfsForPair(id: TfPairId): { htf: ChartTimeframe; ltf: ChartTimeframe } {
  switch (id) {
    case '1h-15m':
      return { htf: '1h', ltf: '15m' };
    case '1h-5m':
      return { htf: '1h', ltf: '5m' };
    case '15m-5m':
      return { htf: '15m', ltf: '5m' };
    case '1h-1h':
      return { htf: '1h', ltf: '1h' };
    case '15m-15m':
      return { htf: '15m', ltf: '15m' };
    case '5m-5m':
      return { htf: '5m', ltf: '5m' };
  }
}
