/**
 * Типы и константы для «Расширенного бэктеста» — секции BacktestPanel,
 * которая гоняет один прогон на N свечей (10к/25к/50к/100к).
 *
 * Вынесено из BacktestPanel.tsx, потому что react-refresh/only-export-components
 * запрещает экспортировать не-React-сущности из файлов с компонентами.
 */

/** Допустимые размеры окна для расширенного бэктеста. */
export type ExtendedCandleCount = 10000 | 25000 | 50000 | 100000;

export const EXTENDED_CANDLE_OPTIONS: readonly ExtendedCandleCount[] = [10000, 25000, 50000, 100000];

/** Сколько дней Vision нужно подгрузить для N свечей 5m (288 свечей/день). */
export function daysForCandles(n: number): number {
  return Math.max(1, Math.ceil(n / 288));
}

export interface ExtendedProgress {
  /** Где сейчас: качаем Vision / парсим / гоняем бэктест. */
  stage: 'loading' | 'computing';
  /** 1..total для loading; для computing не используется. */
  loaded?: number;
  total?: number;
  /** Дополнительная подпись (имя дня, kbytes и т.д.). */
  label?: string;
}
