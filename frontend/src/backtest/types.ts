import type { Price, SignalType, TimestampMs } from '@/types';

/** Настройки бэктеста — управляются пользователем через UI. */
export interface BacktestSettings {
  /** Отступ стопа от экстремума сигнальной свечи (в % от цены входа). */
  stopPct: number;
  /** Мультипликатор тейк-профита к размеру стопа (R:R). */
  rewardRatio: number;
  /**
   * Расширение зоны интереса в % от высоты зоны.
   * Например 10 = 10% — если свеча чуть не дошла до зоны, всё равно ищем вход.
   */
  zoneGapPct: number;
  /** Макс. перезаходов в одной зоне после стопа (пересвип-логика). 0 = без перезаходов. */
  maxReentries: number;
  /** FVG считается валидным, пока не перекрыт более чем на X%. 0–100. */
  fvgMaxFillPct: number;
  /** Макс. размер тела сигнальной свечи в % от цены. 0 = без ограничения. */
  maxCandleBodyPct: number;
  /** Мин. размер FVG в % от цены. FVG меньше этого порога игнорируются. */
  minFvgPct: number;
  /** Включить диагностический лог (запись в backtest-log.txt). */
  debugLog: boolean;
  /** Разрешить перезаходы в зону даже после успешной сделки (win). */
  reentryAfterWin: boolean;
}

export const DEFAULT_BACKTEST_SETTINGS: BacktestSettings = {
  stopPct: 0.3,
  rewardRatio: 2,
  zoneGapPct: 10,
  maxReentries: 1,
  fvgMaxFillPct: 50,
  maxCandleBodyPct: 1,
  minFvgPct: 0.1,
  debugLog: false,
  reentryAfterWin: false,
};

/** Одна сделка бэктеста. */
export interface BacktestTrade {
  id: string;
  type: SignalType;
  /** Зона, из которой вошли (SMC zone id). */
  zoneId: string;
  /** Номер входа в этой зоне (0 = первый, 1 = первый перезаход, ...). */
  entryNumber: number;
  /** Время входа — close сигнальной свечи. */
  entryTime: TimestampMs;
  /** Цена входа — close сигнальной свечи. */
  entryPrice: Price;
  /** Цена стоп-лосса. */
  stopPrice: Price;
  /** Цена тейк-профита. */
  takePrice: Price;
  /** Результат: 'win' | 'loss' | 'open' (не закрылась в рамках данных). */
  outcome: 'win' | 'loss' | 'open';
  /** Время выхода (null если open). */
  exitTime: TimestampMs | null;
  /** Цена выхода. */
  exitPrice: Price | null;
  /** P&L в единицах R (1.0 = один стоп). */
  pnlR: number;
}

/** Агрегированная статистика бэктеста. */
export interface BacktestReport {
  totalTrades: number;
  wins: number;
  losses: number;
  openTrades: number;
  winRate: number;
  totalPnlR: number;
  avgPnlR: number;
  maxConsecutiveLosses: number;
  trades: BacktestTrade[];
}
