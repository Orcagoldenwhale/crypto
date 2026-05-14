/**
 * Детальная карточка ОДНОЙ сделки бэктеста — floating-панель справа-внизу.
 *
 * Показывает:
 *   - Тип / исход / время / P&L (R)
 *   - Цены: entry, SL, TP, exit (если закрыта)
 *   - Зона из которой вошли: тип + диапазон цены
 *   - 4 правила сканера (полярность / Δ / vs VPOC / поглощение) с реальными
 *     числами и ✓/✗ — пересчёт через checkSignal/buildDiagnostics из entry-свечи
 *
 * Навигация: ← / → между сделками внутри текущего отчёта.
 * При смене сделки chart-вьюпорт центрируется на entryTime (вызов в App.tsx).
 */

import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type { BacktestTrade } from '@/backtest/types';
import type { SmcZoneRect } from '@/backtest/runBacktest';
import type { Candle5m } from '@/types';
import { buildDiagnostics, checkSignal } from '@/scanner/checkSignal';

interface Props {
  trade: BacktestTrade;
  /** Entry-свеча для расчёта диагностики 4 правил. null = свеча не найдена. */
  entryCandle: Candle5m | null;
  /** Зона, из которой вошли (lookup по trade.zoneId). null = не найдена. */
  zone: SmcZoneRect | null;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function BacktestTradeViewerPanel({
  trade,
  entryCandle,
  zone,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const isLong = trade.type === 'LONG';

  // Диагностика 4 правил из entry-свечи. Считаем мемоизированно — свеча
  // не меняется на одной и той же сделке.
  const diagnostics = useMemo(() => {
    if (!entryCandle) return null;
    const check = checkSignal(entryCandle);
    // Если правила не сошлись (теоретически невозможно — сделка создаётся
    // только из подтверждённого сигнала), всё равно отдадим diagnostics
    // по направлению trade.type — числа корректны.
    void check;
    return buildDiagnostics(entryCandle, trade.type);
  }, [entryCandle, trade.type]);

  const entryDate = new Date(trade.entryTime);
  const timeStr = entryDate.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const outcomeColor =
    trade.outcome === 'win'
      ? 'text-tv-up'
      : trade.outcome === 'loss'
        ? 'text-tv-down'
        : 'text-amber-400';
  const outcomeLabel =
    trade.outcome === 'win'
      ? `+${trade.pnlR.toFixed(1)}R`
      : trade.outcome === 'loss'
        ? `${trade.pnlR.toFixed(1)}R`
        : 'OPEN';

  return (
    <div className="absolute bottom-3 right-3 z-30 w-[360px] overflow-hidden rounded-md border border-tv-accent/40 bg-tv-panel/98 shadow-2xl backdrop-blur-sm">
      {/* Заголовок */}
      <div
        className={`flex items-center justify-between border-b border-tv-accent/30 px-3 py-2 ${
          isLong ? 'bg-tv-up/10' : 'bg-tv-down/10'
        }`}
      >
        <div className="flex items-center gap-2">
          {isLong ? (
            <TrendingUp className="h-4 w-4 text-tv-up" />
          ) : (
            <TrendingDown className="h-4 w-4 text-tv-down" />
          )}
          <span
            className={`text-xs font-bold tracking-wider uppercase ${
              isLong ? 'text-tv-up' : 'text-tv-down'
            }`}
          >
            {trade.type}
          </span>
          <span className={`text-[11px] font-bold ${outcomeColor}`}>{outcomeLabel}</span>
          <span className="font-mono text-[11px] text-tv-text-muted">{timeStr}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="rounded p-1 text-tv-text-muted hover:text-tv-text"
            title={collapsed ? 'Развернуть' : 'Свернуть'}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-tv-text-muted hover:text-tv-text"
            title="Закрыть"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Цены + навигация */}
          <div className="flex items-center justify-between border-b border-tv-border bg-tv-bg-deep px-3 py-2">
            <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[10px]">
              <span className="text-tv-text-muted">Entry</span>
              <span className="text-tv-text-muted">SL</span>
              <span className="text-tv-text-muted">TP</span>
              <span className="font-mono font-bold text-tv-text">
                {trade.entryPrice.toFixed(2)}
              </span>
              <span className="font-mono text-tv-down">{trade.stopPrice.toFixed(2)}</span>
              <span className="font-mono text-tv-up">{trade.takePrice.toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-1">
              <NavButton onClick={onPrev} disabled={total <= 1} title="Предыдущая">
                <ChevronLeft className="h-4 w-4" />
              </NavButton>
              <span className="font-mono text-[11px] text-tv-text-muted">
                {index} / {total}
              </span>
              <NavButton onClick={onNext} disabled={total <= 1} title="Следующая">
                <ChevronRight className="h-4 w-4" />
              </NavButton>
            </div>
          </div>

          {/* Зона */}
          <div className="border-b border-tv-border px-3 py-1.5">
            <div className="text-[9px] font-bold tracking-widest text-tv-text-muted uppercase">
              Зона входа
            </div>
            {zone ? (
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="rounded border border-tv-accent/30 bg-tv-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-tv-accent">
                  {zoneTypeLabel(trade.zoneId)}
                </span>
                <span className="font-mono text-[10px] text-tv-text-dim">
                  {zone.minPrice.toFixed(2)} – {zone.maxPrice.toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="pt-0.5 text-[10px] text-tv-text-dim">
                {zoneTypeLabel(trade.zoneId)} (бэктест-зона не найдена в текущем оверлее)
              </div>
            )}
          </div>

          {/* 4 правила сканера */}
          {diagnostics ? (
            <div className="space-y-1.5 px-3 py-2.5">
              <RuleRow
                n={1}
                name="Поляризация"
                pass={
                  isLong
                    ? diagnostics.close > diagnostics.mid
                    : diagnostics.close < diagnostics.mid
                }
                detail={
                  <>
                    close{' '}
                    <span className="font-mono text-tv-text">{diagnostics.close.toFixed(2)}</span>{' '}
                    {isLong ? '>' : '<'} mid{' '}
                    <span className="font-mono text-tv-text">{diagnostics.mid.toFixed(2)}</span>
                  </>
                }
              />
              <RuleRow
                n={2}
                name="Total Δ"
                pass={isLong ? diagnostics.totalDelta > 0 : diagnostics.totalDelta < 0}
                detail={
                  <>
                    Δ свечи{' '}
                    <span
                      className={`font-mono font-bold ${
                        diagnostics.totalDelta > 0
                          ? 'text-tv-up'
                          : diagnostics.totalDelta < 0
                            ? 'text-tv-down'
                            : 'text-tv-text'
                      }`}
                    >
                      {diagnostics.totalDelta > 0 ? '+' : ''}
                      {formatVol(diagnostics.totalDelta)}
                    </span>{' '}
                    {isLong ? '> 0' : '< 0'}
                  </>
                }
              />
              <RuleRow
                n={3}
                name="Close vs VPOC"
                pass={
                  isLong
                    ? diagnostics.close > diagnostics.vpoc_price
                    : diagnostics.close < diagnostics.vpoc_price
                }
                detail={
                  <>
                    close{' '}
                    <span className="font-mono text-tv-text">{diagnostics.close.toFixed(2)}</span>{' '}
                    {isLong ? '>' : '<'} VPOC{' '}
                    <span className="font-mono text-tv-text">
                      {diagnostics.vpoc_price.toFixed(2)}
                    </span>
                  </>
                }
              />
              <RuleRow
                n={4}
                name={isLong ? 'Поглощение в low' : 'Поглощение в high'}
                pass={
                  isLong ? diagnostics.delta_at_low < 0 : diagnostics.delta_at_high > 0
                }
                detail={
                  <>
                    Δ@{isLong ? 'low' : 'high'}{' '}
                    <span className="font-mono font-bold text-amber-400">
                      {(isLong ? diagnostics.delta_at_low : diagnostics.delta_at_high) > 0
                        ? '+'
                        : ''}
                      {formatVol(
                        isLong ? diagnostics.delta_at_low : diagnostics.delta_at_high,
                      )}
                    </span>{' '}
                    {isLong ? '< 0' : '> 0'}
                  </>
                }
              />
            </div>
          ) : (
            <div className="px-3 py-2.5 text-[10px] text-tv-text-dim">
              Entry-свеча не найдена в текущем датасете — диагностика 4 правил недоступна.
            </div>
          )}

          {/* Подвал */}
          <div className="border-t border-tv-border bg-tv-bg-deep px-3 py-1.5 text-center font-mono text-[10px] text-tv-text-muted">
            Сделка подсвечена на графике · ← / → для перехода
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Вспомогательные подкомпоненты
// ============================================================================

interface RuleRowProps {
  n: number;
  name: string;
  pass: boolean;
  detail: React.ReactNode;
}

function RuleRow({ n, name, pass, detail }: RuleRowProps) {
  return (
    <div
      className={`flex items-start gap-2 rounded border px-2 py-1.5 ${
        pass ? 'border-tv-up/30 bg-tv-up/5' : 'border-tv-border bg-tv-bg-deep/50'
      }`}
    >
      <div
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          pass ? 'bg-tv-up text-white' : 'bg-tv-border text-tv-text-muted'
        }`}
      >
        {pass ? '✓' : n}
      </div>
      <div className="flex-1 text-[11px] leading-4">
        <div className="font-semibold text-tv-text">{name}</div>
        <div className="text-tv-text-dim">{detail}</div>
      </div>
    </div>
  );
}

interface NavButtonProps {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}

function NavButton({ onClick, disabled, title, children }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border border-tv-border bg-tv-panel-hover p-1 text-tv-text-dim transition-colors hover:bg-tv-panel-active hover:text-tv-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function formatVol(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(2)}k`;
  return v.toFixed(2);
}

/** Префикс zoneId → человекочитаемое имя типа зоны. */
function zoneTypeLabel(zoneId: string): string {
  if (zoneId.startsWith('fvg-')) return 'FVG';
  if (zoneId.startsWith('ob-')) return 'Order Block';
  if (zoneId.startsWith('bb-')) return 'Breaker Block';
  if (zoneId.startsWith('rb-')) return 'Rejection Block';
  if (zoneId.startsWith('liq-')) return 'Liquidity';
  if (zoneId.startsWith('str-')) return 'Structure';
  return zoneId;
}
