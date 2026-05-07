import { useRef } from 'react';
import { Maximize2, FileText, ArrowLeft, Sparkles, FolderOpen, Radio } from 'lucide-react';
import type { LiveStatus, Timeframe } from '@/types';
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
  /** Тоггл live-режима. */
  onToggleLive: () => void;
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
  onToggleLive,
}: HeaderProps) {
  // input type=file держим скрытым и кликаем программно — стандартная техника.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
