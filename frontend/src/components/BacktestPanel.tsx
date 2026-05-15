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
import { Play, Settings2, ChevronUp, ChevronDown, Zap, X, List } from 'lucide-react';
import type { BacktestSettings, BacktestReport } from '@/backtest/types';
import {
  EXTENDED_CANDLE_OPTIONS,
  daysForCandles,
  type ExtendedCandleCount,
  type ExtendedProgress,
} from './BacktestPanelExtended';

interface BacktestPanelProps {
  settings: BacktestSettings;
  onSettingsChange: (next: BacktestSettings) => void;
  onRun: (settings: BacktestSettings) => void;
  report: BacktestReport | null;
  running: boolean;
  /**
   * Запуск расширенного бэктеста на N свечей. Грузит Vision, ПОДМЕНЯЕТ
   * основной chart-датасет на длинное окно, прогоняет regular backtest.
   * После завершения report показывается в основной карточке (а не отдельно),
   * график рисует все N свечей с зонами/сделками.
   */
  onRunExtended: (settings: BacktestSettings, candleCount: ExtendedCandleCount) => void;
  /** true пока идёт загрузка/прогон расширенного. */
  extendedRunning: boolean;
  /** Прогресс расширенного бэктеста (null если не идёт). */
  extendedProgress: ExtendedProgress | null;
  /**
   * Размер активной extended-выборки (null = просмотр обычной 7-дневной).
   * Показываем banner в панели когда не null + кнопку «вернуться к 7д».
   */
  extendedCandleCountActive: ExtendedCandleCount | null;
  /** Отменить идущий расширенный бэктест. */
  onCancelExtended: () => void;
  /** Сбросить флаг extended; данные остаются до явной перезагрузки. */
  onResetExtended: () => void;
  /**
   * Открыть просмотрщик сделок (Trade Viewer): floating-карточка с
   * навигацией prev/next по сделкам бэктеста. Кнопка отображается только
   * когда в отчёте есть хотя бы одна сделка.
   */
  onOpenTradeViewer: () => void;
}

export function BacktestPanel({
  settings,
  onSettingsChange,
  onRun,
  report,
  running,
  onRunExtended,
  extendedRunning,
  extendedProgress,
  extendedCandleCountActive,
  onCancelExtended,
  onResetExtended,
  onOpenTradeViewer,
}: BacktestPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [extendedCount, setExtendedCount] = useState<ExtendedCandleCount>(50000);

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
              <Row label="Стоп-лосс (%)" hint="Верхний предел отступа SL от цены входа. При включённом 'SL за фитилём' выбирается ближайший из (stopPct, фитиль)">
                <NumberInput
                  value={settings.stopPct}
                  min={0.05}
                  max={10}
                  step={0.05}
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
                label="SL за фитилём OB"
                hint="для OB/BB/RB — кандидат на SL = граница зоны. Применяется ближайший из (stopPct, фитиль)"
                checked={settings.slBehindObWick}
                onChange={(v) => update('slBehindObWick', v)}
              />
              <Toggle
                label="SL за дальней границей FVG"
                hint="для FVG — кандидат на SL = дальний край гэпа. Применяется ближайший из (stopPct, граница)"
                checked={settings.slBehindFvgEdge}
                onChange={(v) => update('slBehindFvgEdge', v)}
              />
              <Toggle
                label="SL за свингом"
                hint="кандидат на SL = последний подтверждённый swing-low (LONG) / swing-high (SHORT) на LTF. Применяется ближайший из (stopPct, фитиль зоны, свинг)"
                checked={settings.slBehindSwing}
                onChange={(v) => update('slBehindSwing', v)}
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
              <Row label="FVG жизнь (свечей)" hint="0 = без ограничения. N>0 → FVG старше N свечей пропускается даже если не заполнен">
                <NumberInput
                  value={settings.fvgMaxLifetimeCandles}
                  min={0}
                  max={1000}
                  step={5}
                  onChange={(v) => update('fvgMaxLifetimeCandles', v)}
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
              <Row
                label="Окно лимит-ордера (свечей)"
                hint="Для Open/MT/Wick: сколько свечей ждать ретеста после сигнала. Если за N свечей цена не дошла до target — сделка пропускается. Для Close не используется."
              >
                <NumberInput
                  value={settings.entryLimitTimeoutCandles}
                  min={1}
                  max={200}
                  step={1}
                  onChange={(v) => update('entryLimitTimeoutCandles', v)}
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

          {/* Расширенный бэктест: грузит Vision на N свечей и переключает
              chart на длинное окно. После завершения report показывается в
              основной карточке выше (та же, что и регулярный бэктест). */}
          <div className="border-t border-tv-border px-3 py-2">
            {extendedCandleCountActive !== null && !extendedRunning ? (
              <>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-accent">
                    Просмотр {extendedCandleCountActive.toLocaleString('ru-RU')} свечей (~{daysForCandles(extendedCandleCountActive)}д)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onResetExtended}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-tv-border px-3 py-1 text-[11px] text-tv-text-muted transition-colors hover:bg-tv-panel-hover hover:text-white"
                  title="Выйти из режима просмотра расширенной выборки. Перезагрузить 7-дневную историю можно через кнопку «Загрузить» сверху."
                >
                  <X className="h-3 w-3" />
                  Закрыть расширенный режим
                </button>
              </>
            ) : (
              <>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
                    Расширенный бэктест
                  </span>
                  <select
                    value={extendedCount}
                    onChange={(e) => setExtendedCount(Number(e.target.value) as ExtendedCandleCount)}
                    disabled={extendedRunning}
                    className="rounded border border-tv-border bg-tv-bg-deep px-1.5 py-0.5 text-[10px] text-white outline-none focus:border-tv-accent disabled:opacity-40"
                    title="Сколько 5m-свечей подгрузить из Vision и прогнать на текущих настройках. График переключится на эту выборку."
                  >
                    {EXTENDED_CANDLE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n.toLocaleString('ru-RU')} (~{daysForCandles(n)}д)
                      </option>
                    ))}
                  </select>
                </div>
                {extendedRunning ? (
                  <ExtendedProgressBar
                    progress={extendedProgress}
                    onCancel={onCancelExtended}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onRunExtended(settings, extendedCount)}
                    disabled={running}
                    className="flex w-full items-center justify-center gap-1.5 rounded border border-tv-accent/40 bg-tv-accent/15 px-3 py-1 text-[11px] font-semibold text-tv-accent transition-colors hover:bg-tv-accent/30 disabled:opacity-50"
                    title={`Прогнать на ${extendedCount.toLocaleString('ru-RU')} свечей. График переключится на длинное окно — на нём будут видны все зоны и сделки.`}
                  >
                    <Zap className="h-3 w-3" />
                    Прогнать {extendedCount.toLocaleString('ru-RU')} свечей
                  </button>
                )}
              </>
            )}
          </div>

          {report && (
            extendedCandleCountActive !== null ? (
              <BacktestReportView
                report={report}
                title={`Бэктест на ${extendedCandleCountActive.toLocaleString('ru-RU')} свечей (~${daysForCandles(extendedCandleCountActive)}д)`}
                accent
                onOpenTradeViewer={onOpenTradeViewer}
              />
            ) : (
              <BacktestReportView report={report} onOpenTradeViewer={onOpenTradeViewer} />
            )
          )}
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

function BacktestReportView({
  report,
  title,
  accent,
  onOpenTradeViewer,
}: {
  report: BacktestReport;
  title?: string;
  accent?: boolean;
  onOpenTradeViewer?: () => void;
}) {
  const wr = (report.winRate * 100).toFixed(1);
  // Считаем LONG/SHORT тут (а не в state) — данные уже в report.trades,
  // дополнительной памяти не требует, всегда актуально на момент render'а.
  let longCount = 0;
  let shortCount = 0;
  for (const t of report.trades) {
    if (t.type === 'LONG') longCount++;
    else if (t.type === 'SHORT') shortCount++;
  }
  return (
    <div className={`border-t px-3 py-2 ${accent ? 'border-tv-accent/40 bg-tv-accent/5' : 'border-tv-border'}`}>
      {title && (
        <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${accent ? 'text-tv-accent' : 'text-tv-text-muted'}`}>
          {title}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        <StatLine label="Сделок" value={String(report.totalTrades)} />
        <StatLine
          label="L / S"
          value={`${longCount} / ${shortCount}`}
          color="text-tv-text"
        />
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
      {onOpenTradeViewer && report.totalTrades > 0 && (
        <button
          type="button"
          onClick={onOpenTradeViewer}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-tv-accent/40 bg-tv-accent/10 px-3 py-1 text-[11px] font-semibold text-tv-accent hover:bg-tv-accent/20"
          title="Открыть карточку первой сделки. Внутри — переключение prev/next, подсветка сделки и зоны на графике."
        >
          <List className="h-3 w-3" />
          Просмотр сделок
        </button>
      )}
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

/**
 * Прогресс расширенного бэктеста — две стадии:
 *   1) loading: качаем/парсим Vision-дни (есть прогресс N/total)
 *   2) computing: считаем overlay + бэктест (короткая, без числового прогресса)
 */
function ExtendedProgressBar({
  progress,
  onCancel,
}: {
  progress: ExtendedProgress | null;
  onCancel: () => void;
}) {
  const pct = progress?.stage === 'loading' && progress.total && progress.total > 0
    ? Math.min(100, Math.round(((progress.loaded ?? 0) / progress.total) * 100))
    : null;
  const stageLabel = progress?.stage === 'computing'
    ? 'Считаем overlay + бэктест…'
    : 'Загрузка Vision';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] text-tv-text-muted">
        <span>{stageLabel}{progress?.label ? ` · ${progress.label}` : ''}</span>
        <button
          type="button"
          onClick={onCancel}
          title="Отменить расширенный бэктест"
          className="flex items-center gap-1 rounded border border-tv-border px-1.5 py-0.5 text-[10px] text-tv-text-muted hover:bg-red-500 hover:text-white"
        >
          <X className="h-2.5 w-2.5" />
          Отмена
        </button>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-tv-bg-deep">
        <div
          className={`h-full ${pct !== null ? 'bg-tv-accent' : 'animate-pulse bg-tv-accent/60'}`}
          style={pct !== null ? { width: `${pct}%` } : { width: '100%' }}
        />
      </div>
      {pct !== null && progress?.total !== undefined && (
        <div className="text-right text-[9px] text-tv-text-muted">
          {progress.loaded ?? 0} / {progress.total} ({pct}%)
        </div>
      )}
    </div>
  );
}
