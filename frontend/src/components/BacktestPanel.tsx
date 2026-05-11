import { useState } from 'react';
import { Play, Settings2, ChevronUp, ChevronDown } from 'lucide-react';
import type { BacktestSettings, BacktestReport } from '@/backtest/types';
import { DEFAULT_BACKTEST_SETTINGS } from '@/backtest/types';

interface BacktestPanelProps {
  onRun: (settings: BacktestSettings) => void;
  report: BacktestReport | null;
  running: boolean;
}

export function BacktestPanel({ onRun, report, running }: BacktestPanelProps) {
  const [settings, setSettings] = useState<BacktestSettings>(DEFAULT_BACKTEST_SETTINGS);
  const [collapsed, setCollapsed] = useState(false);

  const update = <K extends keyof BacktestSettings>(key: K, value: BacktestSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="absolute right-20 top-0 z-40 flex flex-col items-center">
      {/* Panel body */}
      {!collapsed && (
        <div className="w-64 rounded-b-lg border border-t-0 border-tv-border bg-tv-panel shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Settings2 className="h-3.5 w-3.5 text-tv-accent" />
            <span className="text-xs font-semibold text-white">Бэктест</span>
          </div>

          {/* Settings */}
          <div className="space-y-1.5 px-3 py-1.5">
            <SettingRow label="Стоп-лосс (%)" title="Отступ стопа от цены входа в процентах">
              <NumberInput
                value={settings.stopPct}
                min={0.05}
                max={10}
                step={0.05}
                onChange={(v) => update('stopPct', v)}
              />
            </SettingRow>

            <SettingRow label="Reward (R:R)" title="Мультипликатор тейка к размеру стопа">
              <NumberInput
                value={settings.rewardRatio}
                min={0.5}
                max={20}
                step={0.5}
                onChange={(v) => update('rewardRatio', v)}
              />
            </SettingRow>

            <SettingRow label="Gap зоны (%)" title="Расширение зоны интереса — ищем вход даже если цена чуть не дошла">
              <NumberInput
                value={settings.zoneGapPct}
                min={0}
                max={100}
                step={5}
                onChange={(v) => update('zoneGapPct', v)}
              />
            </SettingRow>

            <SettingRow label="Перезаходов" title="Макс. повторных входов в одной зоне после стопа (пересвип)">
              <NumberInput
                value={settings.maxReentries}
                min={0}
                max={10}
                step={1}
                onChange={(v) => update('maxReentries', v)}
              />
            </SettingRow>
          </div>

          {/* Run button */}
          <div className="px-3 py-1.5">
            <button
              type="button"
              onClick={() => onRun(settings)}
              disabled={running}
              className="flex w-full items-center justify-center gap-1.5 rounded bg-tv-accent px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-tv-accent-hover disabled:opacity-50"
            >
              {running ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Прогоняем...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Запустить
                </>
              )}
            </button>
          </div>

          {/* Report */}
          {report && <BacktestReportView report={report} />}
        </div>
      )}

      {/* Toggle arrow — always visible at the bottom edge */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? 'Развернуть бэктест' : 'Свернуть бэктест'}
        className="flex items-center gap-1 rounded-b-md border border-t-0 border-tv-border bg-tv-panel px-3 py-0.5 text-tv-text-dim shadow-lg transition-colors hover:bg-tv-panel-hover hover:text-white"
      >
        {collapsed ? (
          <>
            <Settings2 className="h-3 w-3 text-tv-accent" />
            <ChevronDown className="h-3 w-3" />
          </>
        ) : (
          <ChevronUp className="h-3 w-3" />
        )}
      </button>
    </div>
  );
}

function BacktestReportView({ report }: { report: BacktestReport }) {
  const wr = (report.winRate * 100).toFixed(1);
  return (
    <div className="border-t border-tv-border px-3 py-1.5">
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        <StatLine label="Сделок" value={String(report.totalTrades)} />
        <StatLine
          label="W / L"
          value={`${report.wins} / ${report.losses}`}
          color={report.wins >= report.losses ? 'text-tv-up' : 'text-tv-down'}
        />
        <StatLine
          label="Winrate"
          value={`${wr}%`}
          color={report.winRate >= 0.5 ? 'text-tv-up' : 'text-tv-down'}
        />
        <StatLine
          label="P&L (R)"
          value={report.totalPnlR >= 0 ? `+${report.totalPnlR.toFixed(1)}` : report.totalPnlR.toFixed(1)}
          color={report.totalPnlR >= 0 ? 'text-tv-up' : 'text-tv-down'}
        />
        <StatLine
          label="Avg (R)"
          value={report.avgPnlR >= 0 ? `+${report.avgPnlR.toFixed(2)}` : report.avgPnlR.toFixed(2)}
          color={report.avgPnlR >= 0 ? 'text-tv-up' : 'text-tv-down'}
        />
        <StatLine label="Серия лоссов" value={String(report.maxConsecutiveLosses)} />
        {report.openTrades > 0 && (
          <StatLine label="Открытые" value={String(report.openTrades)} color="text-amber-400" />
        )}
      </div>
    </div>
  );
}

function StatLine({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <>
      <span className="text-tv-text-dim">{label}</span>
      <span className={`text-right font-mono ${color ?? 'text-white'}`}>{value}</span>
    </>
  );
}

function SettingRow({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between" title={title}>
      <span className="text-[11px] text-tv-text">{label}</span>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v >= min && v <= max) onChange(v);
      }}
      className="w-20 rounded border border-tv-border bg-tv-bg-deep px-2 py-0.5 text-right font-mono text-[11px] text-white outline-none focus:border-tv-accent"
    />
  );
}
