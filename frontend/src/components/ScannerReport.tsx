/**
 * Floating-отчёт сканера в правом-нижнем углу.
 * Появляется после успешного прогона `runScanner`.
 */

import { ChevronDown, Target, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useState } from 'react';
import type { ScannerReport as ScannerReportData } from '@/types';

interface Props {
  report: ScannerReportData;
  /** Время выполнения в воркере, ms */
  elapsedMs: number;
  /** Сканер прошёл по всему датасету, а не по зонам пользователя. */
  isExploreMode?: boolean;
  onClose: () => void;
}

export function ScannerReport({
  report,
  elapsedMs,
  isExploreMode = false,
  onClose,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-3 right-3 z-30 w-72 overflow-hidden rounded-md border border-tv-border bg-tv-panel/98 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider text-tv-text uppercase">
          <Target className="h-3.5 w-3.5 text-tv-accent" />
          {isExploreMode ? 'Сканер · explore' : 'Отчёт сканера'}
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
        <div className="px-3 py-3">
          {isExploreMode && (
            <div className="mb-2 rounded border border-tv-accent/30 bg-tv-accent/5 px-2 py-1.5 text-[11px] text-tv-text-dim">
              Зон не размечено — сканер прошёл по всему датасету. Найденные сигналы
              помечены ▲▼ на LTF. Нарисуйте POI вокруг них и запустите снова.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Зон всего" value={report.zonesTotal} />
            <Stat label="Со сигналом" value={report.zonesWithSignal} accent />
            <Stat
              label="LONG"
              value={report.longCount}
              icon={<TrendingUp className="h-3 w-3 text-tv-up" />}
            />
            <Stat
              label="SHORT"
              value={report.shortCount}
              icon={<TrendingDown className="h-3 w-3 text-tv-down" />}
            />
          </div>

          <div className="mt-3 rounded border border-tv-border bg-tv-bg-deep px-2 py-1.5 text-center font-mono text-[11px] text-tv-text-dim">
            Найдено сигналов: <span className="font-bold text-tv-text">{report.signalsTotal}</span>
            <span className="ml-2 text-tv-text-muted/60">· {elapsedMs.toFixed(1)} ms (worker)</span>
          </div>

          {report.signalsTotal === 0 && (
            <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-center text-[11px] text-amber-200">
              Сигналов не найдено. 4 правила вместе срабатывают редко —
              попробуйте расширить зону или сначала запустите сканер БЕЗ зон
              (explore-режим), чтобы увидеть, где в данных вообще есть сигналы.
            </div>
          )}
          {report.signalsTotal > 0 && (
            <div className="mt-2 text-center text-[11px] text-tv-text-muted">
              Переключитесь на LTF, чтобы увидеть маркеры (▲ LONG, ▼ SHORT) на свечах.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: number;
  accent?: boolean;
  icon?: React.ReactNode;
}

function Stat({ label, value, accent = false, icon }: StatProps) {
  return (
    <div className="rounded border border-tv-border bg-tv-bg-deep px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-tv-text-muted">
        {icon}
        {label}
      </div>
      <div
        className={`font-mono text-base font-bold ${accent ? 'text-tv-accent' : 'text-tv-text'}`}
      >
        {value}
      </div>
    </div>
  );
}
