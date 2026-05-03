/**
 * Каталог поддерживаемых символов.
 *
 * Каждый символ — это отдельный предзагруженный JSON в `frontend/public/`,
 * сгенерированный Python-pipeline (см. `data-pipeline/`).
 *
 * При добавлении нового символа:
 *   1) Сгенерировать `<symbol>-5d.json` через `smc-data <SYMBOL> --tick-size <X>`.
 *   2) Положить в `frontend/public/`.
 *   3) Дописать запись сюда — UI подхватит автоматически.
 */

export interface SymbolInfo {
  /** Тикер в верхнем регистре, например 'BTCUSDT'. */
  id: string;
  /** Короткое имя для UI: «BTC», «ETH». */
  short: string;
  /** Полное имя инструмента: «Bitcoin», «Ethereum». */
  long: string;
  /** Tick size в исходной сетке Python-pipeline (USDT). */
  tickSize: number;
  /** URL предзагруженного 5-дневного датасета (рядом с index.html). */
  prebuiltUrl: string;
}

export const SYMBOLS: readonly SymbolInfo[] = [
  {
    id: 'BTCUSDT',
    short: 'BTC',
    long: 'Bitcoin',
    tickSize: 5,
    prebuiltUrl: '/btcusdt-5d.json',
  },
  {
    id: 'ETHUSDT',
    short: 'ETH',
    long: 'Ethereum',
    tickSize: 0.5,
    prebuiltUrl: '/ethusdt-5d.json',
  },
  {
    id: 'SOLUSDT',
    short: 'SOL',
    long: 'Solana',
    tickSize: 0.05,
    prebuiltUrl: '/solusdt-5d.json',
  },
  {
    id: 'BNBUSDT',
    short: 'BNB',
    long: 'BNB',
    tickSize: 0.1,
    prebuiltUrl: '/bnbusdt-5d.json',
  },
] as const;

export const DEFAULT_SYMBOL_ID = 'BTCUSDT';

export function findSymbol(id: string): SymbolInfo | null {
  return SYMBOLS.find((s) => s.id === id) ?? null;
}

export function isKnownSymbol(id: string): boolean {
  return SYMBOLS.some((s) => s.id === id);
}
