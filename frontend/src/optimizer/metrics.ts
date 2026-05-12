import type { BacktestReport } from '@/backtest/types';
import type { OptimizerMetric } from './types';

/**
 * Считает score отчёта по выбранной метрике. Чем больше score — тем лучше.
 *
 * Особенности:
 *   - profitFactor: возвращает 0 если нет ни одного closed-trade, чтобы
 *     "пустые" комбинации не выигрывали;
 *   - composite: умножение totalPnlR на winRate — приоритет стабильности.
 *     Если P&L отрицательный, score = totalPnlR (1 × отрицательный),
 *     чтобы они не задавливали положительные с низким winrate.
 */
export function computeScore(
  report: BacktestReport,
  metric: OptimizerMetric,
): number {
  if (report.totalTrades === 0) return -Infinity;

  switch (metric) {
    case 'totalPnlR':
      return report.totalPnlR;
    case 'winRate':
      return report.winRate;
    case 'avgPnlR':
      return report.avgPnlR;
    case 'profitFactor': {
      let wins = 0;
      let losses = 0;
      for (const t of report.trades) {
        if (t.outcome === 'win') wins += t.pnlR;
        else if (t.outcome === 'loss') losses += Math.abs(t.pnlR);
      }
      if (losses === 0) return wins > 0 ? Number.POSITIVE_INFINITY : 0;
      return wins / losses;
    }
    case 'composite': {
      const r = report.totalPnlR;
      if (r <= 0) return r;
      return r * report.winRate;
    }
  }
}
