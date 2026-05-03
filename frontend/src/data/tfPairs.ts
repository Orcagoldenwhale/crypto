import type { ChartTimeframe, TfPairId } from '@/types';

/** Варианты пар «старший → младший» для UI. */
export const TF_PAIR_OPTIONS: readonly { id: TfPairId; label: string; hint: string }[] = [
  { id: '1h-15m', label: '1h → 15m', hint: 'Зоны на часовом, входы на 15m' },
  { id: '1h-5m', label: '1h → 5m', hint: 'Зоны на часовом, входы на 5m' },
  { id: '15m-5m', label: '15m → 5m', hint: 'Классика: зоны на 15m, входы на 5m' },
] as const;

export const DEFAULT_TF_PAIR: TfPairId = '15m-5m';

export function parseTfPair(id: string): TfPairId | null {
  if (id === '1h-15m' || id === '1h-5m' || id === '15m-5m') return id;
  return null;
}

export function chartTfsForPair(id: TfPairId): { htf: ChartTimeframe; ltf: ChartTimeframe } {
  switch (id) {
    case '1h-15m':
      return { htf: '1h', ltf: '15m' };
    case '1h-5m':
      return { htf: '1h', ltf: '5m' };
    case '15m-5m':
      return { htf: '15m', ltf: '5m' };
  }
}
