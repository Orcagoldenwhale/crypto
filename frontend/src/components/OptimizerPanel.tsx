/**
 * Полноэкранная модалка оптимизатора параметров бэктеста.
 *
 * Слева — конфигурация параметров (грид с from/to/step или toggles).
 * Справа — кнопка запуска, прогресс, таблица топ-N результатов.
 *
 * При клике "Применить" на строке результатов — настройки уходят в
 * BacktestSettings (через onApply), пользователь сам жмёт "Запустить"
 * в обычной панели бэктеста для верификации.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Play, Rocket, X, Square } from 'lucide-react';
import type { BacktestReport, BacktestSettings } from '@/backtest/types';
import type { Candle5m } from '@/types';
import type { SmcOverlay } from '@/engine/smc/types';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  METRIC_LABEL,
  type OptimizableKey,
  type OptimizerMetric,
  type OptimizerResult,
  type OptimizerSettings,
  type ParamSpec,
} from '@/optimizer/types';
import { countCombinations, generateGrid } from '@/optimizer/generateGrid';
import { runOptimizer } from '@/optimizer/runOptimizer';

interface OptimizerPanelProps {
  baseSettings: BacktestSettings;
  candles: readonly Candle5m[];
  overlay: SmcOverlay;
  onClose: () => void;
  /** Применить найденные параметры к BacktestSettings. */
  onApply: (next: BacktestSettings) => void;
}

const PARAM_LABELS: Record<OptimizableKey, string> = {
  stopPct: 'Стоп-лосс (%)',
  rewardRatio: 'Reward (R:R)',
  zoneGapPct: 'Gap зоны (%)',
  maxReentries: 'Перезаходов',
  minFvgPct: 'Мин. FVG (%)',
  maxCandleBodyPct: 'Макс. тело свечи (%)',
  reentryAfterWin: 'Перезаход после win',
  slBehindObWick: 'SL за фитилём OB',
  slBehindFvgEdge: 'SL за дальней границей FVG',
  validityByMt: 'Валидность по MT',
  entryPoint: 'Точка входа',
};

export function OptimizerPanel({
  baseSettings,
  candles,
  overlay,
  onClose,
  onApply,
}: OptimizerPanelProps) {
  const [optSettings, setOptSettings] = useState<OptimizerSettings>(DEFAULT_OPTIMIZER_SETTINGS);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; best: number | null }>({
    done: 0,
    total: 0,
    best: null,
  });
  const [results, setResults] = useState<OptimizerResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Esc → закрыть.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (running) abortRef.current?.abort();
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, onClose]);

  const total = useMemo(() => countCombinations(optSettings.specs), [optSettings.specs]);

  const setSpec = (key: OptimizableKey, next: ParamSpec) => {
    setOptSettings((prev) => ({ ...prev, specs: { ...prev.specs, [key]: next } }));
  };

  const handleRun = async () => {
    if (total === 0 || running) return;
    if (candles.length === 0) {
      window.alert('Нет данных для оптимизации — сначала загрузите свечи.');
      return;
    }
    const combos = generateGrid(optSettings.specs);
    setResults([]);
    setProgress({ done: 0, total: combos.length, best: null });
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const found = await runOptimizer({
        candles,
        overlay,
        baseSettings,
        combos,
        optSettings,
        signal: ac.signal,
        onProgress: (p) => setProgress({ done: p.done, total: p.total, best: p.bestScore }),
      });
      setResults(found);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !running) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdrop}
      role="presentation"
    >
      <div
        className="flex h-[90vh] w-[90vw] max-w-7xl flex-col rounded-lg border border-tv-border bg-tv-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Оптимизатор бэктеста"
      >
        <header className="flex items-center justify-between border-b border-tv-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-tv-accent" />
            <span className="text-sm font-semibold uppercase tracking-wider text-tv-text">
              Оптимизатор бэктеста
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="text-tv-text-muted hover:text-tv-text disabled:opacity-40"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-hidden">
          <div className="grid h-full grid-cols-1 md:grid-cols-[minmax(360px,1fr)_2fr]">
            {/* Левая колонка: параметры */}
            <div className="overflow-y-auto border-r border-tv-border p-4">
              <SectionTitle>Параметры перебора</SectionTitle>
              <p className="mb-3 text-[10px] text-tv-text-muted">
                Включите параметры, задайте диапазон. Оптимизатор переберёт все
                сочетания и найдёт лучшие по выбранной метрике.
              </p>
              <div className="flex flex-col gap-2">
                {(Object.keys(optSettings.specs) as OptimizableKey[]).map((key) => (
                  <ParamRow
                    key={key}
                    label={PARAM_LABELS[key]}
                    spec={optSettings.specs[key]}
                    onChange={(next) => setSpec(key, next)}
                  />
                ))}
              </div>

              <SectionTitle className="mt-5">Метрика</SectionTitle>
              <select
                value={optSettings.metric}
                onChange={(e) => setOptSettings({ ...optSettings, metric: e.target.value as OptimizerMetric })}
                className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
              >
                {(Object.keys(METRIC_LABEL) as OptimizerMetric[]).map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABEL[m]}
                  </option>
                ))}
              </select>

              <SectionTitle className="mt-5">Результаты</SectionTitle>
              <label className="flex items-center justify-between text-[11px] text-tv-text">
                <span>Top-N</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={optSettings.topN}
                  onChange={(e) => setOptSettings({ ...optSettings, topN: clampInt(+e.target.value, 1, 500, 20) })}
                  className="w-20 rounded border border-tv-border bg-tv-bg-deep px-2 py-0.5 text-right font-mono text-[11px] text-white"
                />
              </label>
            </div>

            {/* Правая колонка: запуск и результаты */}
            <div className="flex flex-col overflow-hidden">
              <div className="border-b border-tv-border p-4">
                <div className="mb-2 flex items-center justify-between text-xs text-tv-text">
                  <span>
                    Всего комбинаций: <strong className="text-tv-accent">{total === Infinity ? '∞' : total}</strong>
                  </span>
                  {total > 10000 && (
                    <span className="text-[10px] text-amber-400">
                      Большой объём — может занять время. Можно прервать.
                    </span>
                  )}
                </div>
                {!running ? (
                  <button
                    type="button"
                    onClick={handleRun}
                    disabled={total === 0}
                    className="flex w-full items-center justify-center gap-1.5 rounded bg-tv-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-tv-accent-hover disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Запустить оптимизацию
                  </button>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] text-tv-text">
                      <span>
                        Прогресс: {progress.done} / {progress.total}{' '}
                        ({Math.round((progress.done / Math.max(1, progress.total)) * 100)}%)
                      </span>
                      {progress.best !== null && (
                        <span className="font-mono text-tv-text-muted">
                          best: {progress.best.toFixed(3)}
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded bg-tv-bg-deep">
                      <div
                        className="h-full bg-tv-accent transition-all"
                        style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => abortRef.current?.abort()}
                      className="flex items-center justify-center gap-1.5 rounded border border-tv-border px-2 py-1 text-[11px] text-tv-text-dim hover:text-white"
                    >
                      <Square className="h-3 w-3" />
                      Прервать
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-auto p-4">
                {results.length === 0 ? (
                  <p className="text-center text-xs text-tv-text-muted">
                    {running ? 'Идёт прогон…' : 'Запустите оптимизацию — результаты появятся здесь.'}
                  </p>
                ) : (
                  <ResultsTable
                    results={results}
                    metric={optSettings.metric}
                    baseSettings={baseSettings}
                    onApply={onApply}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Building blocks
// ============================================================================

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`mb-2 text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted ${className ?? ''}`}>
      {children}
    </h3>
  );
}

function ParamRow({
  label,
  spec,
  onChange,
}: {
  label: string;
  spec: ParamSpec;
  onChange: (next: ParamSpec) => void;
}) {
  const enabled = spec.enabled;
  return (
    <div className={`rounded border border-tv-border/60 bg-tv-bg-deep/40 p-2 ${enabled ? '' : 'opacity-60'}`}>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ ...spec, enabled: e.target.checked })}
          className="h-3.5 w-3.5 accent-tv-accent"
        />
        <span className="text-[11px] font-medium text-tv-text">{label}</span>
        {spec.type === 'number' && enabled && (
          <span className="ml-auto font-mono text-[10px] text-tv-text-muted">
            {countNumberValues(spec)} зн.
          </span>
        )}
      </label>
      {enabled && spec.type === 'number' && (
        <div className="mt-2 grid grid-cols-3 gap-1">
          <NumInput
            label="от"
            value={spec.from}
            step={spec.step}
            onChange={(v) => onChange({ ...spec, from: v })}
          />
          <NumInput
            label="до"
            value={spec.to}
            step={spec.step}
            onChange={(v) => onChange({ ...spec, to: v })}
          />
          <NumInput
            label="шаг"
            value={spec.step}
            step={spec.step}
            onChange={(v) => onChange({ ...spec, step: Math.max(0.001, v) })}
          />
        </div>
      )}
      {enabled && spec.type === 'bool' && (
        <p className="mt-1 text-[10px] text-tv-text-muted">
          Перебираются оба значения: false, true
        </p>
      )}
      {enabled && spec.type === 'enum' && (
        <p className="mt-1 text-[10px] text-tv-text-muted">
          Значения: {spec.values.join(', ')}
        </p>
      )}
    </div>
  );
}

function countNumberValues(spec: { from: number; to: number; step: number }): number {
  if (spec.step <= 0) return 0;
  return Math.floor((spec.to - spec.from) / spec.step + 1e-9) + 1;
}

function NumInput({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-tv-text-muted">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full rounded border border-tv-border bg-tv-bg-deep px-1 py-0.5 text-right font-mono text-[11px] text-white outline-none focus:border-tv-accent"
      />
    </label>
  );
}

function ResultsTable({
  results,
  metric,
  baseSettings,
  onApply,
}: {
  results: readonly OptimizerResult[];
  metric: OptimizerMetric;
  baseSettings: BacktestSettings;
  onApply: (next: BacktestSettings) => void;
}) {
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-tv-panel text-tv-text-muted">
        <tr>
          <th className="px-2 py-1 text-left">#</th>
          <th className="px-2 py-1 text-right">{METRIC_LABEL[metric]}</th>
          <th className="px-2 py-1 text-right">Сделок</th>
          <th className="px-2 py-1 text-right">W/L</th>
          <th className="px-2 py-1 text-right">Winrate</th>
          <th className="px-2 py-1 text-right">P&L (R)</th>
          <th className="px-2 py-1 text-left">Параметры</th>
          <th className="px-2 py-1" />
        </tr>
      </thead>
      <tbody>
        {results.map((r, idx) => (
          <ResultRow
            key={idx}
            idx={idx + 1}
            result={r}
            baseSettings={baseSettings}
            onApply={onApply}
          />
        ))}
      </tbody>
    </table>
  );
}

function ResultRow({
  idx,
  result,
  baseSettings,
  onApply,
}: {
  idx: number;
  result: OptimizerResult;
  baseSettings: BacktestSettings;
  onApply: (next: BacktestSettings) => void;
}) {
  const { report, params, score } = result;
  return (
    <tr className="border-t border-tv-border/40 hover:bg-tv-panel-hover">
      <td className="px-2 py-1 text-tv-text-muted">{idx}</td>
      <td className="px-2 py-1 text-right font-mono text-tv-accent">{formatScore(score)}</td>
      <td className="px-2 py-1 text-right font-mono">{report.totalTrades}</td>
      <td className="px-2 py-1 text-right font-mono">
        <span className="text-tv-up">{report.wins}</span>/
        <span className="text-tv-down">{report.losses}</span>
      </td>
      <td className={`px-2 py-1 text-right font-mono ${report.winRate >= 0.5 ? 'text-tv-up' : 'text-tv-down'}`}>
        {(report.winRate * 100).toFixed(1)}%
      </td>
      <td className={`px-2 py-1 text-right font-mono ${report.totalPnlR >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>
        {report.totalPnlR >= 0 ? '+' : ''}{report.totalPnlR.toFixed(1)}
      </td>
      <td className="px-2 py-1 font-mono text-tv-text-muted text-[10px]">
        {formatParams(params)}
      </td>
      <td className="px-2 py-1">
        <button
          type="button"
          onClick={() => onApply({ ...baseSettings, ...params })}
          className="rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-accent hover:bg-tv-accent hover:text-white"
        >
          Применить
        </button>
      </td>
    </tr>
  );
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return score > 0 ? '∞' : '-∞';
  return score.toFixed(3);
}

function formatParams(params: Partial<BacktestSettings>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(3).replace(/\.?0+$/, '') : v}`)
    .join(' · ');
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
