import { useEffect, useRef, useState } from 'react';
import { Maximize2, FileText, ArrowLeft, Sparkles, FolderOpen, Radio, FlaskConical, Rocket } from 'lucide-react';
import type { LiveStatus, Timeframe } from '@/types';
import type { LiveDebugStats } from '@/data/liveCandleManager';
import { APP_VERSION, buildTimeShort } from '@/version';
import { SymbolPicker } from './SymbolPicker';
import { LiveStatusBadge } from './LiveStatusBadge';

interface HeaderProps {
  /** Активный слот графика (1h / 15m / 5m). */
  chartTf: Timeframe;
  /**
   * Режим экрана:
   *   'htf'    — старший ТФ (зоны),
   *   'ltf'    — младший ТФ (сканер, маркеры),
   *   'single' — единый ТФ (зоны + сканер на одной оси).
   */
  chartView: 'htf' | 'ltf' | 'single';
  symbol: string;
  onSymbolChange: (id: string) => void;
  isLoading: boolean;
  onLoadHistory: () => void;
  onLoadMock: () => void;
  onLoadFile: (file: File) => void;
  onBackToHTF: () => void;

  /** Live-режим: текущий статус потока. */
  liveStatus: LiveStatus;
  /** true когда живая лента работает (любой статус кроме idle). */
  liveActive: boolean;
  /** Диагностика live-стрима в реальном времени (тики/снапшоты/последний тик). */
  liveStats: LiveDebugStats | null;
  /** Тоггл live-режима. */
  onToggleLive: () => void;
  /** Бэктест: открыть/закрыть панель настроек. */
  backtestOpen: boolean;
  onToggleBacktest: () => void;
  /** Открыть/закрыть окно оптимизатора. */
  optimizerOpen: boolean;
  onToggleOptimizer: () => void;
}

export function Header({
  chartTf,
  chartView,
  symbol,
  onSymbolChange,
  isLoading,
  onLoadHistory,
  onLoadMock,
  onLoadFile,
  onBackToHTF,
  liveStatus,
  liveActive,
  liveStats,
  onToggleLive,
  backtestOpen,
  onToggleBacktest,
  optimizerOpen,
  onToggleOptimizer,
}: HeaderProps) {
  // input type=file держим скрытым и кликаем программно — стандартная техника.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Тикающая «секунда назад» в строке диагностики live: чтобы цифра обновлялась
  // даже когда новых тиков нет (ясно видно «WS замолчал»).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!liveActive) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveActive]);

  const handlePickFile = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoadFile(file);
    // Сбрасываем value, чтобы повторный выбор того же файла снова стрелял onChange.
    e.target.value = '';
  };

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-tv-border bg-tv-panel px-4">
      <div className="flex items-center gap-3">
        <Maximize2 className="h-5 w-5 text-tv-accent" />
        <h1 className="text-lg font-bold tracking-tight text-white">
          SMC Terminal
          <span
            className="ml-2 font-mono text-xs font-normal text-tv-text-muted"
            title={`Build time: ${buildTimeShort()}`}
          >
            v{APP_VERSION}
            <span className="ml-1 text-tv-text-dim">· {buildTimeShort()}</span>
          </span>
        </h1>
        <div className="ml-4 flex items-center gap-2 text-xs">
          <SymbolPicker value={symbol} onChange={onSymbolChange} disabled={isLoading} />
          <span
            className="rounded border border-tv-border bg-tv-bg-deep px-1.5 py-0.5 font-mono text-tv-text-dim"
            title={
              chartView === 'htf'
                ? 'HTF — разметка зон'
                : chartView === 'ltf'
                  ? 'LTF — сканер, маркеры и footprint'
                  : `Single — зоны и сканер на одном ${chartTf}`
            }
          >
            {chartTf}
            <span className="text-tv-text-dim"> · </span>
            <span className="text-tv-text">
              {chartView === 'htf' ? 'HTF' : chartView === 'ltf' ? 'LTF' : 'SINGLE'}
            </span>
          </span>
          <LiveStatusBadge status={liveStatus} />
          {liveActive && liveStats && (
            <LiveStatsLine stats={liveStats} nowMs={nowMs} />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {chartView === 'ltf' && (
          <button
            type="button"
            onClick={onBackToHTF}
            className="flex items-center gap-2 rounded bg-tv-panel-hover px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-tv-panel-active"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад к HTF
          </button>
        )}
        <button
          type="button"
          onClick={onToggleBacktest}
          title="Бэктест стратегии по включённым SMC-слоям"
          className={
            backtestOpen
              ? 'flex items-center gap-2 rounded border border-amber-500 bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/30'
              : 'flex items-center gap-2 rounded border border-tv-border bg-tv-panel-hover px-3 py-1.5 text-sm font-medium text-tv-text transition-colors hover:bg-tv-panel-active'
          }
        >
          <FlaskConical className="h-4 w-4" />
          Бэктест
        </button>
        <button
          type="button"
          onClick={onToggleOptimizer}
          title="Оптимизатор параметров бэктеста (грид-поиск)"
          className={
            optimizerOpen
              ? 'flex items-center gap-2 rounded border border-fuchsia-500 bg-fuchsia-500/20 px-3 py-1.5 text-sm font-medium text-fuchsia-300 transition-colors hover:bg-fuchsia-500/30'
              : 'flex items-center gap-2 rounded border border-tv-border bg-tv-panel-hover px-3 py-1.5 text-sm font-medium text-tv-text transition-colors hover:bg-tv-panel-active'
          }
        >
          <Rocket className="h-4 w-4" />
          Оптимизатор
        </button>
        <button
          type="button"
          onClick={onLoadMock}
          disabled={isLoading || liveActive}
          title="Сгенерировать демо-данные с моделированными кластерами (для проверки footprint)"
          className="flex items-center gap-2 rounded border border-tv-border bg-tv-panel-hover px-3 py-1.5 text-sm font-medium text-tv-text transition-colors hover:bg-tv-panel-active disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          Демо
        </button>
        <button
          type="button"
          onClick={onToggleLive}
          disabled={isLoading}
          title={
            liveActive
              ? 'Остановить live-стрим Binance'
              : 'Подключить live-поток aggTrades с Binance (real-time)'
          }
          className={
            liveActive
              ? 'flex items-center gap-2 rounded border border-emerald-500 bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.45)] transition-colors hover:bg-emerald-500/30 disabled:opacity-50'
              : 'flex items-center gap-2 rounded border border-tv-border bg-tv-panel-hover px-3 py-1.5 text-sm font-medium text-tv-text transition-colors hover:bg-tv-panel-active disabled:opacity-50'
          }
        >
          <Radio className="h-4 w-4" />
          {liveActive ? 'Live · stop' : 'Live'}
        </button>
        <button
          type="button"
          onClick={handlePickFile}
          disabled={isLoading || liveActive}
          title="Открыть локальный JSON, сгенерированный smc-data (или просто перетащить файл в окно)"
          className="flex items-center gap-2 rounded border border-tv-border bg-tv-panel-hover px-3 py-1.5 text-sm font-medium text-tv-text transition-colors hover:bg-tv-panel-active disabled:opacity-50"
        >
          <FolderOpen className="h-4 w-4" />
          Открыть JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={onLoadHistory}
          disabled={isLoading || liveActive}
          title="Реальные aggTrades с Binance Vision (7 дней)"
          className="flex items-center gap-2 rounded bg-tv-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-tv-accent-hover disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          {isLoading ? 'Загрузка...' : 'Загрузить историю'}
        </button>
      </div>
    </header>
  );
}

/**
 * Inline-диагностика live-стрима: «тики · кластеры · последний тик».
 *
 * Зачем: пользователь сразу видит, идут ли данные из WebSocket. Если число
 * тиков растёт — стрим жив. Если не меняется > 30 сек — текст краснеет
 * (явный сигнал «Binance не шлёт»). Не требует открытия DevTools.
 */
function LiveStatsLine({
  stats,
  nowMs,
}: {
  stats: LiveDebugStats;
  nowMs: number;
}) {
  const ageSec =
    stats.lastTickAt > 0 ? Math.max(0, Math.round((nowMs - stats.lastTickAt) / 1000)) : null;
  const stale = ageSec !== null && ageSec > 30;
  const noTicks = stats.ticksReceived === 0;

  let lastLabel: string;
  if (noTicks) {
    lastLabel = 'нет тиков';
  } else if (ageSec === null) {
    lastLabel = '—';
  } else {
    lastLabel = `${ageSec}с назад`;
  }

  return (
    <span
      className={
        stale || noTicks
          ? 'rounded border border-rose-500/60 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[11px] text-rose-300'
          : 'rounded border border-tv-border bg-tv-bg-deep px-1.5 py-0.5 font-mono text-[11px] text-tv-text-dim'
      }
      title="Тиков из WS · кластеров в open-свече · с момента последнего тика"
    >
      <span className="text-tv-text">тиков:</span> {stats.ticksReceived.toLocaleString('ru-RU')}
      <span className="mx-1 text-tv-text-dim">·</span>
      <span className="text-tv-text">кл:</span> {stats.openCandleClusters}
      <span className="mx-1 text-tv-text-dim">·</span>
      <span className="text-tv-text">посл.:</span> {lastLabel}
    </span>
  );
}
