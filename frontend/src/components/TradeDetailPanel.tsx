/**
 * Детальная карточка выбранного сигнала — floating-панель внизу-слева.
 *
 * Показывает разбор 4 правил с реальными числами (не бинарными галочками):
 *   R1 polarity     — close vs (high+low)/2
 *   R2 totalDelta   — суммарная Δ свечи
 *   R3 closeVsVpoc  — close vs vpoc_price
 *   R4 absorption   — delta_at_low (LONG) или delta_at_high (SHORT)
 *
 * Навигация: prev/next по сигналам в текущем порядке.
 */

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { Signal } from '@/types';

interface Props {
  signal: Signal;
  /** Порядковый номер сигнала (1-based) и общее количество — для навигации. */
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function TradeDetailPanel({
  signal,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const isLong = signal.type === 'LONG';
  const d = signal.diagnostics;

  const polarityPassed = isLong ? d.close > d.mid : d.close < d.mid;
  const deltaPassed = isLong ? d.totalDelta > 0 : d.totalDelta < 0;
  const vpocPassed = isLong ? d.close > d.vpoc_price : d.close < d.vpoc_price;
  const absorptionPassed = isLong ? d.delta_at_low < 0 : d.delta_at_high > 0;

  const dt = new Date(signal.candleTime);
  const timeStr = dt.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="absolute bottom-3 left-3 z-30 w-[340px] overflow-hidden rounded-md border border-amber-500/40 bg-tv-panel/98 shadow-2xl backdrop-blur-sm">
      {/* Заголовок */}
      <div
        className={`flex items-center justify-between border-b border-amber-500/30 px-3 py-2 ${
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
            {signal.type}
          </span>
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
            title="Закрыть · Esc"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Цена и навигация */}
          <div className="flex items-center justify-between border-b border-tv-border bg-tv-bg-deep px-3 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-tv-text-muted">
                Цена входа
              </div>
              <div className="font-mono text-base font-bold text-tv-text">
                {d.close.toFixed(2)}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <NavButton onClick={onPrev} disabled={total <= 1} title="Предыдущий · ←">
                <ChevronLeft className="h-4 w-4" />
              </NavButton>
              <span className="font-mono text-[11px] text-tv-text-muted">
                {index} / {total}
              </span>
              <NavButton onClick={onNext} disabled={total <= 1} title="Следующий · →">
                <ChevronRight className="h-4 w-4" />
              </NavButton>
            </div>
          </div>

          {/* 4 правила */}
          <div className="space-y-1.5 px-3 py-2.5">
            <RuleRow
              n={1}
              name="Поляризация"
              pass={polarityPassed}
              detail={
                <>
                  close{' '}
                  <span className="font-mono text-tv-text">{d.close.toFixed(2)}</span>{' '}
                  {polarityPassed ? (isLong ? '>' : '<') : isLong ? '≤' : '≥'} mid{' '}
                  <span className="font-mono text-tv-text">{d.mid.toFixed(2)}</span>
                </>
              }
            />
            <RuleRow
              n={2}
              name="Total Δ"
              pass={deltaPassed}
              detail={
                <>
                  Δ свечи{' '}
                  <span
                    className={`font-mono font-bold ${
                      d.totalDelta > 0 ? 'text-tv-up' : d.totalDelta < 0 ? 'text-tv-down' : 'text-tv-text'
                    }`}
                  >
                    {d.totalDelta > 0 ? '+' : ''}
                    {formatVol(d.totalDelta)}
                  </span>
                  {' '}
                  {isLong ? '> 0 (покупки доминируют)' : '< 0 (продажи доминируют)'}
                </>
              }
            />
            <RuleRow
              n={3}
              name="Close vs VPOC"
              pass={vpocPassed}
              detail={
                <>
                  close{' '}
                  <span className="font-mono text-tv-text">{d.close.toFixed(2)}</span>{' '}
                  {vpocPassed ? (isLong ? '>' : '<') : isLong ? '≤' : '≥'} VPOC{' '}
                  <span className="font-mono text-tv-text">{d.vpoc_price.toFixed(2)}</span>
                </>
              }
            />
            <RuleRow
              n={4}
              name={isLong ? 'Поглощение в low' : 'Поглощение в high'}
              pass={absorptionPassed}
              detail={
                <>
                  Δ@{isLong ? 'low' : 'high'}{' '}
                  <span
                    className={`font-mono font-bold ${
                      absorptionPassed ? 'text-amber-400' : 'text-tv-text-muted'
                    }`}
                  >
                    {(isLong ? d.delta_at_low : d.delta_at_high) > 0 ? '+' : ''}
                    {formatVol(isLong ? d.delta_at_low : d.delta_at_high)}
                  </span>{' '}
                  {isLong
                    ? '< 0 (агрессивные продавцы поглощены)'
                    : '> 0 (агрессивные покупатели поглощены)'}
                </>
              }
            />
          </div>

          {/* Бонус-индикаторы (необязательные) */}
          <div className="space-y-1.5 border-t border-tv-border bg-tv-bg-deep/40 px-3 py-2">
            <div className="text-[9px] font-bold tracking-widest text-tv-text-muted uppercase">
              Бонус · необязательно
            </div>
            <BonusRow
              icon={isLong ? '🟢' : '🔴'}
              label={isLong ? 'Имбалансы покупок' : 'Имбалансы продаж'}
              value={d.imbalanceCount}
              hint={
                d.imbalanceCount === 0
                  ? 'нет — поток не однонаправленный'
                  : d.imbalanceCount === 1
                  ? '1 уровень — слабый сигнал'
                  : `${d.imbalanceCount} уровней — поток ${isLong ? 'покупок' : 'продаж'} насыщен`
              }
              positive={d.imbalanceCount >= 2}
              isLong={isLong}
            />
            <BonusRow
              icon="🎯"
              label={
                isLong
                  ? 'Нуль на low (ask=0)'
                  : 'Нуль на high (bid=0)'
              }
              value={d.hasZeroAtExtreme ? '✓' : '—'}
              hint={
                d.hasZeroAtExtreme
                  ? 'аукцион исчерпан на экстремуме'
                  : 'на экстремуме поток есть'
              }
              positive={d.hasZeroAtExtreme}
              isLong={isLong}
            />
          </div>

          {/* Подвал */}
          <div className="border-t border-tv-border bg-tv-bg-deep px-3 py-1.5 text-center font-mono text-[10px] text-tv-text-muted">
            Все 4 правила сошлись · ← / → для перехода между сигналами
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
        pass
          ? 'border-tv-up/30 bg-tv-up/5'
          : 'border-tv-border bg-tv-bg-deep/50'
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

interface BonusRowProps {
  icon: string;
  label: string;
  /** Значение справа: число имбалансов или галочка "✓" / прочерк "—". */
  value: number | string;
  hint: string;
  /** Если true — подсвечиваем зелёной/красной рамкой по направлению сигнала. */
  positive: boolean;
  isLong: boolean;
}

/**
 * Строка бонус-индикатора. По смыслу похожа на RuleRow, но визуально слабее
 * (без номера, без бейджа «✓/n») — это намеренный сигнал «не обязательно».
 */
function BonusRow({ icon, label, value, hint, positive, isLong }: BonusRowProps) {
  const accent = positive
    ? isLong
      ? 'border-tv-up/40 bg-tv-up/5 text-tv-up'
      : 'border-tv-down/40 bg-tv-down/5 text-tv-down'
    : 'border-tv-border bg-tv-bg-deep/30 text-tv-text-muted';
  return (
    <div className={`flex items-center gap-2 rounded border px-2 py-1 ${accent}`}>
      <span className="text-sm leading-none">{icon}</span>
      <div className="flex-1 text-[11px] leading-tight">
        <div className="font-semibold text-tv-text">{label}</div>
        <div className="text-[10px] text-tv-text-dim">{hint}</div>
      </div>
      <div className="font-mono text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
