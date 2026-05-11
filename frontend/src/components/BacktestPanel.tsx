/**
 * Панель настроек бэктеста — докнута к правому верху графика.
 *
 * Структура:
 *   - Шапка с тогглом сворачивания.
 *   - Секции настроек (Section) — каждая со своим заголовком и группой параметров.
 *     Добавить новую настройку = бросить ещё одну строку в нужную секцию.
 *     Добавить новую секцию = новый <Section title="..."> блок.
 *   - Кнопка "Запустить".
 *   - Отчёт (если есть).
 *
 * Секции:
 *   1. Управление риском — стоп, reward, SL за фитилём.
 *   2. Зоны и фильтры   — gap зоны, мин. FVG, макс. тело сигнальной.
 *   3. Перезаходы       — maxReentries, reentryAfterWin, validityByMt.
 *   4. Точка входа      — entryPoint (Close / Open / MT / Wick).
 *   5. Диагностика      — debug log.
 */

import { useState, type ReactNode } from 'react';
import { Play, Settings2, ChevronUp, ChevronDown } from 'lucide-react';
import type { BacktestSettings, BacktestReport } from '@/backtest/types';

interface BacktestPanelProps {
  settings: BacktestSettings;
  onSettingsChange: (next: BacktestSettings) => void;
  onRun: (settings: BacktestSettings) => void;
  report: BacktestReport | null;
  running: boolean;
}

export function BacktestPanel({ settings, onSettingsChange, onRun, report, running }: BacktestPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const update = <K extends keyof BacktestSettings>(key: K, value: BacktestSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="absolute right-20 top-0 z-40 flex flex-col items-center">
      {!collapsed && (
        <div className="w-80 rounded-b-lg border border-t-0 border-tv-border bg-tv-panel shadow-2xl">
          <div className="flex items-center gap-2 border-b border-tv-border px-3 py-2">
            <Settings2 className="h-3.5 w-3.5 text-tv-accent" />
            <span className="text-xs font-semibold text-white">Бэктест</span>
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-3 py-2">
            <Section title="Управление риском">
              <Row label="Стоп-лосс (%)" hint="Отступ стопа от цены входа в %">
                <NumberInput
                  value={settings.stopPct}
                  min={0.05}
                  max={10}
                  step={0.05}
                  disabled={settings.slBehindWick}
                  onChange={(v) => update('stopPct', v)}
                />
              </Row>
              <Row label="Reward (R:R)" hint="Мультипликатор тейка к размеру стопа">
                <NumberInput
                  value={settings.rewardRatio}
                  min={0.5}
                  max={20}
                  step={0.5}
                  onChange={(v) => update('rewardRatio', v)}
                />
              </Row>
              <Toggle
                label="SL за фитилём зоны"
                hint="для OB/BB/RB ставить SL на границе зоны вместо stopPct"
                checked={settings.slBehindWick}
                onChange={(v) => update('slBehindWick', v)}
              />
            </Section>

            <Section title="Зоны и фильтры">
              <Row label="Gap зоны (%)" hint="расширить зону интереса по краям">
                <NumberInput
                  value={settings.zoneGapPct}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) => update('zoneGapPct', v)}
                />
              </Row>
              <Row label="Мин. FVG (%)" hint="мелкие гэпы игнорируются">
                <NumberInput
                  value={settings.minFvgPct}
                  min={0}
                  max={5}
                  step={0.05}
                  onChange={(v) => update('minFvgPct', v)}
                />
              </Row>
              <Row label="Макс. тело свечи (%)" hint="0 = без ограничения">
                <NumberInput
                  value={settings.maxCandleBodyPct}
                  min={0}
                  max={10}
                  step={0.1}
                  onChange={(v) => update('maxCandleBodyPct', v)}
                />
              </Row>
            </Section>

            <Section title="Перезаходы">
              <Row label="Макс. перезаходов" hint="после стопа — сколько раз ещё пробуем">
                <NumberInput
                  value={settings.maxReentries}
                  min={0}
                  max={10}
                  step={1}
                  onChange={(v) => update('maxReentries', v)}
                />
              </Row>
              <Toggle
                label="Перезаход после win"
                hint="разрешить входить в зону снова после успешной сделки"
                checked={settings.reentryAfterWin}
                onChange={(v) => update('reentryAfterWin', v)}
              />
              <Toggle
                label="Валидность по MT"
                hint="OB живёт пока тело свечи не закрылось за 50% тела (Mean Threshold)"
                checked={settings.validityByMt}
                onChange={(v) => update('validityByMt', v)}
              />
            </Section>

            <Section title="Точка входа">
              <Row label="Уровень" hint="по какой цене заходим в сделку">
                <Select
                  value={settings.entryPoint}
                  onChange={(v) => update('entryPoint', v as BacktestSettings['entryPoint'])}
                  options={[
                    { value: 'close', label: 'Close свечи' },
                    { value: 'open', label: 'Open OB (ретест)' },
                    { value: 'mt', label: 'Mean Threshold' },
                    { value: 'wick', label: 'Дальний фитиль' },
                  ]}
                />
              </Row>
            </Section>

            <Section title="Диагностика">
              <Toggle
                label="Debug лог"
                hint="писать backtest-log.txt с причинами отказа"
                checked={settings.debugLog}
                onChange={(v) => update('debugLog', v)}
              />
            </Section>
          </div>

          <div className="border-t border-tv-border px-3 py-2">
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

          {report && <BacktestReportView report={report} />}
        </div>
      )}

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

// ============================================================================
// Building blocks
// ============================================================================

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {title}
      </h4>
      <div className="flex flex-col gap-1.5 rounded border border-tv-border/60 bg-tv-bg-deep/40 p-2">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2" title={hint}>
      <span className="text-[11px] text-tv-text">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2" title={hint}>
      <span className="text-[11px] text-tv-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-tv-accent"
      />
    </label>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v >= min && v <= max) onChange(v);
      }}
      className="w-20 rounded border border-tv-border bg-tv-bg-deep px-2 py-0.5 text-right font-mono text-[11px] text-white outline-none focus:border-tv-accent disabled:opacity-40"
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-40 rounded border border-tv-border bg-tv-bg-deep px-2 py-0.5 text-[11px] text-white outline-none focus:border-tv-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function BacktestReportView({ report }: { report: BacktestReport }) {
  const wr = (report.winRate * 100).toFixed(1);
  return (
    <div className="border-t border-tv-border px-3 py-2">
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
