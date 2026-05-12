/**
 * Полноэкранная модалка оптимизатора параметров бэктеста.
 *
 * Слева — конфигурация параметров, сгруппированных по разделам:
 *   - Бэктест (всегда)
 *   - SMC: Структура (всегда — lookback касается всех)
 *   - SMC: FVG (только если layers.fvg)
 *   - SMC: OB (только если layers.orderBlocks)
 *   - SMC: RB (только если layers.rejectionBlocks)
 *
 * Справа — кнопка запуска, прогресс, таблица топ-N результатов.
 * При "Применить" к строке: BT-параметры идут в backtestSettings,
 * SMC-параметры — в smcOptions через onApplySmc.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Rocket, X, Square, Star, Trash2, Save, RotateCcw } from 'lucide-react';
import type { BacktestSettings } from '@/backtest/types';
import type { SmcLayers, SmcOptions } from '@/engine/smc/types';
import type { PreparedData } from '@/optimizer/runOptimizer';
import {
  loadOptimizerDefaults,
  loadSaved,
  persistOptimizerDefaults,
  persistSaved,
  snapshotResult,
  type SavedResult,
} from '@/optimizer/savedResults';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  METRIC_LABEL,
  isSmcKey,
  type BacktestKey,
  type OptimizableKey,
  type OptimizerMetric,
  type OptimizerResult,
  type OptimizerSettings,
  type ParamSpec,
  type SmcKey,
} from '@/optimizer/types';
import { countCombinations, generateGrid } from '@/optimizer/generateGrid';
import { runOptimizer } from '@/optimizer/runOptimizer';

interface OptimizerPanelProps {
  baseSettings: BacktestSettings;
  baseSmcOpts: SmcOptions;
  smcLayers: SmcLayers;
  /**
   * Возвращает свечи для оптимизатора при заданном tickMultiplier.
   * undefined = текущий множитель (как в основном приложении).
   */
  prepareData: (mult: number | undefined) => PreparedData;
  onClose: () => void;
  /** Применить найденные BT-параметры. */
  onApply: (next: BacktestSettings) => void;
  /** Применить найденные SMC-параметры. */
  onApplySmc: (next: SmcOptions) => void;
  /**
   * Применить tick-multiplier (только 1 / 2 / 5 / 10). undefined =
   * параметр не варьировался, ничего не менять.
   */
  onApplyMultiplier?: (mult: 1 | 2 | 5 | 10 | undefined) => void;
}

const PARAM_LABELS: Record<OptimizableKey, string> = {
  tickMultiplier: 'Tick multiplier',
  // Бэктест
  stopPct: 'Стоп-лосс (%)',
  rewardRatio: 'Reward (R:R)',
  zoneGapPct: 'Gap зоны (%)',
  maxReentries: 'Перезаходов',
  minFvgPct: 'Мин. FVG (%) [бэктест]',
  maxCandleBodyPct: 'Макс. тело свечи (%)',
  reentryAfterWin: 'Перезаход после win',
  slBehindObWick: 'SL за фитилём OB',
  slBehindFvgEdge: 'SL за дальней границей FVG',
  validityByMt: 'Валидность по MT',
  entryPoint: 'Точка входа',
  // SMC
  lookback: 'Lookback (свечи)',
  fvgMaxFillPct: 'FVG fill-порог (%) [SMC]',
  obExtraction: 'Выделение OB',
  obUseMeanThreshold: 'Учитывать MT для OB',
  obRequireAbsorption: 'Требовать поглощение',
  obAllowMultiCandle: 'Multi-candle OB',
  obSearchAtSweep: 'Искать OB на sweep',
  obSearchAtFvg: 'Искать OB на тесте FVG',
  obSearchAtPrevBlock: 'Искать OB на тесте prev OB',
  rbWickRatio: 'RB фитиль/тело (≥)',
  rbRequireSweep: 'RB требовать sweep',
  rbAlsoAtFvg: 'RB фитиль в FVG',
  rbUseMeanThreshold: 'Учитывать MT для RB',
};

interface SectionConfig {
  title: string;
  keys: OptimizableKey[];
  /** Условие, по которому раздел отображается. */
  visible: (layers: SmcLayers) => boolean;
}

const SECTIONS: SectionConfig[] = [
  {
    title: 'Бэктест',
    visible: () => true,
    keys: [
      'stopPct', 'rewardRatio', 'zoneGapPct', 'maxReentries',
      'minFvgPct', 'maxCandleBodyPct',
      'reentryAfterWin', 'slBehindObWick', 'slBehindFvgEdge', 'validityByMt',
      'entryPoint',
    ],
  },
  {
    title: 'SMC: Структура',
    visible: () => true,
    keys: ['lookback'],
  },
  {
    title: 'SMC: FVG',
    visible: (l) => l.fvg,
    keys: ['fvgMaxFillPct'],
  },
  {
    title: 'SMC: Order Blocks',
    visible: (l) => l.orderBlocks || l.breakerBlocks,
    keys: [
      'obExtraction', 'obUseMeanThreshold', 'obRequireAbsorption',
      'obAllowMultiCandle',
      'obSearchAtSweep', 'obSearchAtFvg', 'obSearchAtPrevBlock',
    ],
  },
  {
    title: 'SMC: Rejection Blocks',
    visible: (l) => l.rejectionBlocks,
    keys: [
      'rbWickRatio', 'rbRequireSweep', 'rbAlsoAtFvg', 'rbUseMeanThreshold',
    ],
  },
  {
    title: 'Данные',
    visible: () => true,
    keys: ['tickMultiplier'],
  },
];

export function OptimizerPanel({
  baseSettings,
  baseSmcOpts,
  smcLayers,
  prepareData,
  onClose,
  onApply,
  onApplySmc,
  onApplyMultiplier,
}: OptimizerPanelProps) {
  const [optSettings, setOptSettings] = useState<OptimizerSettings>(
    () => loadOptimizerDefaults() ?? DEFAULT_OPTIMIZER_SETTINGS,
  );

  const handleSaveDefaults = () => {
    persistOptimizerDefaults(optSettings);
  };

  const handleResetDefaults = () => {
    const ok = window.confirm(
      'Сбросить настройки до текущих дефолтных?\nВсе несохранённые изменения будут потеряны.',
    );
    if (!ok) return;
    setOptSettings(loadOptimizerDefaults() ?? DEFAULT_OPTIMIZER_SETTINGS);
  };
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; best: number | null }>({
    done: 0,
    total: 0,
    best: null,
  });
  const [results, setResults] = useState<OptimizerResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // ===== Сохранённые результаты (localStorage) =====
  const [savedResults, setSavedResults] = useState<SavedResult[]>(() => loadSaved());
  const [view, setView] = useState<'optimizer' | 'saved'>('optimizer');

  const saveResult = (r: OptimizerResult) => {
    const snap = snapshotResult(r, optSettings.metric);
    setSavedResults((prev) => {
      const next = [snap, ...prev];
      persistSaved(next);
      return next;
    });
  };

  const deleteSaved = (id: string) => {
    setSavedResults((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSaved(next);
      return next;
    });
  };

  const applySaved = (s: SavedResult) => {
    onApplySmc({ ...baseSmcOpts, ...s.smcParams });
    onApply({ ...baseSettings, ...s.btParams });
    if (onApplyMultiplier && s.dataParams.tickMultiplier !== undefined) {
      onApplyMultiplier(s.dataParams.tickMultiplier as 1 | 2 | 5 | 10);
    }
  };

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

  /** Группа кнопок для пакетного включения/выключения раздела. */
  const enableSection = (section: SectionConfig, value: boolean) => {
    setOptSettings((prev) => {
      const next = { ...prev.specs };
      for (const k of section.keys) {
        next[k] = { ...next[k], enabled: value };
      }
      return { ...prev, specs: next };
    });
  };

  const handleRun = async () => {
    if (total === 0 || running) return;
    // Дешёвая sanity-проверка: пробуем получить текущие данные.
    const probe = prepareData(undefined);
    if (probe.candles.length === 0) {
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
        prepareData,
        baseSmcOpts,
        smcLayers,
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

  const visibleSections = SECTIONS.filter((s) => s.visible(smcLayers));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdrop}
      role="presentation"
    >
      <div
        className="flex h-[95vh] w-[98vw] flex-col rounded-lg border border-tv-border bg-tv-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Оптимизатор бэктеста"
      >
        <header className="flex items-center justify-between border-b border-tv-border px-5 py-2.5">
          <div className="flex items-center gap-3">
            <Rocket className="h-4 w-4 text-tv-accent" />
            <span className="text-sm font-semibold uppercase tracking-wider text-tv-text">
              Оптимизатор
            </span>
            {/* Переключатель вкладок */}
            <div className="ml-1 flex rounded border border-tv-border bg-tv-bg-deep p-0.5">
              <button
                type="button"
                onClick={() => setView('optimizer')}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  view === 'optimizer'
                    ? 'bg-tv-accent text-white'
                    : 'text-tv-text-muted hover:text-tv-text'
                }`}
              >
                Параметры
              </button>
              <button
                type="button"
                onClick={() => setView('saved')}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  view === 'saved'
                    ? 'bg-tv-accent text-white'
                    : 'text-tv-text-muted hover:text-tv-text'
                }`}
              >
                Сохранённые ({savedResults.length})
              </button>
            </div>
            {/* Метрика и Top-N — только во вкладке оптимизатора */}
            {view === 'optimizer' && (
              <>
                <label className="flex items-center gap-1.5 text-[10px] text-tv-text-muted">
                  Метрика
                  <select
                    value={optSettings.metric}
                    onChange={(e) => setOptSettings({ ...optSettings, metric: e.target.value as OptimizerMetric })}
                    className="rounded border border-tv-border bg-tv-bg-deep px-1 py-0.5 text-[10px] text-tv-text outline-none focus:border-tv-accent"
                  >
                    {(Object.keys(METRIC_LABEL) as OptimizerMetric[]).map((m) => (
                      <option key={m} value={m}>{METRIC_LABEL[m]}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-tv-text-muted">
                  Top-N
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={1}
                    value={optSettings.topN}
                    onChange={(e) => setOptSettings({ ...optSettings, topN: clampInt(+e.target.value, 1, 500, 20) })}
                    className="w-14 rounded border border-tv-border bg-tv-bg-deep px-1 py-0.5 text-right font-mono text-[10px] text-white"
                  />
                </label>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {view === 'optimizer' && (
              <>
                <button
                  type="button"
                  onClick={handleSaveDefaults}
                  title="Сохранить текущую конфигурацию как дефолтную (для следующих открытий)"
                  className="flex items-center gap-1 rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                >
                  <Save className="h-3 w-3" />
                  Сохранить как дефолт
                </button>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  title="Сбросить к сохранённому дефолту (с подтверждением)"
                  className="flex items-center gap-1 rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                >
                  <RotateCcw className="h-3 w-3" />
                  Сброс
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="text-tv-text-muted hover:text-tv-text disabled:opacity-40"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {view === 'saved' ? (
          <SavedView
            items={savedResults}
            onApply={applySaved}
            onDelete={deleteSaved}
          />
        ) : (
          <>
        {/* Параметры — в горизонтальной сетке колонок (без вертикального скролла) */}
        <div className="border-b border-tv-border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {visibleSections.map((section) => (
              <SectionBlock
                key={section.title}
                title={section.title}
                specs={section.keys.map((k) => ({ key: k, spec: optSettings.specs[k] }))}
                onChangeSpec={(k, next) => setSpec(k, next)}
                onEnableAll={() => enableSection(section, true)}
                onDisableAll={() => enableSection(section, false)}
              />
            ))}
          </div>
        </div>

        {/* Запуск + результаты */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b border-tv-border p-3">
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

          <div className="flex-1 overflow-auto p-3">
            {results.length === 0 ? (
              <p className="text-center text-xs text-tv-text-muted">
                {running ? 'Идёт прогон…' : 'Запустите оптимизацию — результаты появятся здесь.'}
              </p>
            ) : (
              <ResultsTable
                results={results}
                metric={optSettings.metric}
                baseSettings={baseSettings}
                baseSmcOpts={baseSmcOpts}
                onApply={onApply}
                onApplySmc={onApplySmc}
                onApplyMultiplier={onApplyMultiplier}
                onSave={saveResult}
              />
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Building blocks
// ============================================================================

function SectionBlock({
  title,
  specs,
  onChangeSpec,
  onEnableAll,
  onDisableAll,
}: {
  title: string;
  specs: readonly { key: OptimizableKey; spec: ParamSpec }[];
  onChangeSpec: (key: OptimizableKey, next: ParamSpec) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
}) {
  const allOn = specs.every((s) => s.spec.enabled);
  return (
    <div className="flex flex-col rounded border border-tv-border bg-tv-bg-deep/40 p-2">
      <div className="mb-1.5 flex items-center justify-between border-b border-tv-border/40 pb-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-tv-text">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => (allOn ? onDisableAll() : onEnableAll())}
          className="rounded border border-tv-border px-1 py-0 text-[9px] text-tv-text-muted hover:text-tv-text"
        >
          {allOn ? 'выкл. все' : 'вкл. все'}
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {specs.map(({ key, spec }) => (
          <ParamRow
            key={key}
            label={PARAM_LABELS[key]}
            spec={spec}
            onChange={(next) => onChangeSpec(key, next)}
          />
        ))}
      </div>
    </div>
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
    <div className={`rounded border border-tv-border/40 bg-tv-bg-deep/30 px-1.5 py-1 ${enabled ? '' : 'opacity-55'}`}>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange({ ...spec, enabled: e.target.checked })}
          className="h-3 w-3 accent-tv-accent"
        />
        <span className="flex-1 text-[10px] text-tv-text">{label}</span>
        {spec.type === 'number' && enabled && (
          <span className="font-mono text-[9px] text-tv-text-muted">
            {countNumberValues(spec)}×
          </span>
        )}
      </label>
      {enabled && spec.type === 'number' && (
        <div className="mt-1 grid grid-cols-3 gap-1">
          <NumInput label="от" value={spec.from} step={spec.step} onChange={(v) => onChange({ ...spec, from: v })} />
          <NumInput label="до" value={spec.to} step={spec.step} onChange={(v) => onChange({ ...spec, to: v })} />
          <NumInput label="шаг" value={spec.step} step={spec.step} onChange={(v) => onChange({ ...spec, step: Math.max(0.001, v) })} />
        </div>
      )}
      {enabled && spec.type === 'enum' && (
        <p className="mt-0.5 text-[9px] text-tv-text-muted">{spec.values.join(', ')}</p>
      )}
    </div>
  );
}

function countNumberValues(spec: { from: number; to: number; step: number }): number {
  if (spec.step <= 0) return 0;
  return Math.floor((spec.to - spec.from) / spec.step + 1e-9) + 1;
}

function NumInput({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[9px] text-tv-text-muted">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full min-w-0 rounded border border-tv-border bg-tv-bg-deep px-1 py-0 text-right font-mono text-[10px] text-white outline-none focus:border-tv-accent"
      />
    </label>
  );
}

function ResultsTable({
  results,
  metric,
  baseSettings,
  baseSmcOpts,
  onApply,
  onApplySmc,
  onApplyMultiplier,
  onSave,
}: {
  results: readonly OptimizerResult[];
  metric: OptimizerMetric;
  baseSettings: BacktestSettings;
  baseSmcOpts: SmcOptions;
  onApply: (next: BacktestSettings) => void;
  onApplySmc: (next: SmcOptions) => void;
  onApplyMultiplier?: (mult: 1 | 2 | 5 | 10 | undefined) => void;
  onSave: (r: OptimizerResult) => void;
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
            baseSmcOpts={baseSmcOpts}
            onApply={onApply}
            onApplySmc={onApplySmc}
            onApplyMultiplier={onApplyMultiplier}
            onSave={onSave}
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
  baseSmcOpts,
  onApply,
  onApplySmc,
  onApplyMultiplier,
  onSave,
}: {
  idx: number;
  result: OptimizerResult;
  baseSettings: BacktestSettings;
  baseSmcOpts: SmcOptions;
  onApply: (next: BacktestSettings) => void;
  onApplySmc: (next: SmcOptions) => void;
  onApplyMultiplier?: (mult: 1 | 2 | 5 | 10 | undefined) => void;
  onSave: (r: OptimizerResult) => void;
}) {
  const { report, btParams, smcParams, dataParams, score } = result;
  const handleApply = () => {
    onApplySmc({ ...baseSmcOpts, ...smcParams });
    onApply({ ...baseSettings, ...btParams });
    if (onApplyMultiplier && dataParams.tickMultiplier !== undefined) {
      onApplyMultiplier(dataParams.tickMultiplier as 1 | 2 | 5 | 10);
    }
  };
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
        {formatParams(btParams, smcParams, dataParams)}
      </td>
      <td className="px-2 py-1">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onSave(result)}
            title="Сохранить в коллекцию"
            className="rounded border border-tv-border px-1.5 py-0.5 text-[10px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-amber-400"
          >
            <Star className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-accent hover:bg-tv-accent hover:text-white"
          >
            Применить
          </button>
        </div>
      </td>
    </tr>
  );
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return score > 0 ? '∞' : '-∞';
  return score.toFixed(3);
}

function formatParams(
  bt: Partial<BacktestSettings>,
  smc: Partial<SmcOptions>,
  data: { tickMultiplier?: number },
): string {
  const all: [string, unknown][] = [
    ...Object.entries(bt).map(([k, v]) => [k as string, v] as [string, unknown]),
    ...Object.entries(smc).map(([k, v]) => [`${isSmcKey(k as OptimizableKey) ? 'smc.' : ''}${k}` as string, v] as [string, unknown]),
    ...(data.tickMultiplier !== undefined ? [['mult', `×${data.tickMultiplier}`] as [string, unknown]] : []),
  ];
  return all
    .map(([k, v]) => `${k}=${typeof v === 'number' ? (v as number).toFixed(3).replace(/\.?0+$/, '') : String(v)}`)
    .join(' · ');
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// Silence unused-warnings for narrowed types BacktestKey / SmcKey (re-exported for callers).
export type { BacktestKey, SmcKey };

// ============================================================================
// Сохранённые результаты (вкладка)
// ============================================================================

function SavedView({
  items,
  onApply,
  onDelete,
}: {
  items: readonly SavedResult[];
  onApply: (s: SavedResult) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-xs text-tv-text-muted">
          Здесь будут отображаться сохранённые наборы параметров. Нажмите
          ★ на любой строке результатов оптимизации, чтобы добавить.
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-auto p-3">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-tv-panel text-tv-text-muted">
          <tr>
            <th className="px-2 py-1 text-left">Дата</th>
            <th className="px-2 py-1 text-left">Метрика</th>
            <th className="px-2 py-1 text-right">Score</th>
            <th className="px-2 py-1 text-right">Сделок</th>
            <th className="px-2 py-1 text-right">W/L</th>
            <th className="px-2 py-1 text-right">Winrate</th>
            <th className="px-2 py-1 text-right">P&L (R)</th>
            <th className="px-2 py-1 text-left">Параметры</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-tv-border/40 hover:bg-tv-panel-hover">
              <td className="px-2 py-1 text-tv-text-muted">{formatDate(s.savedAt)}</td>
              <td className="px-2 py-1 text-tv-text-muted">{METRIC_LABEL[s.metric]}</td>
              <td className="px-2 py-1 text-right font-mono text-tv-accent">{formatScore(s.score)}</td>
              <td className="px-2 py-1 text-right font-mono">{s.summary.totalTrades}</td>
              <td className="px-2 py-1 text-right font-mono">
                <span className="text-tv-up">{s.summary.wins}</span>/
                <span className="text-tv-down">{s.summary.losses}</span>
              </td>
              <td className={`px-2 py-1 text-right font-mono ${s.summary.winRate >= 0.5 ? 'text-tv-up' : 'text-tv-down'}`}>
                {(s.summary.winRate * 100).toFixed(1)}%
              </td>
              <td className={`px-2 py-1 text-right font-mono ${s.summary.totalPnlR >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>
                {s.summary.totalPnlR >= 0 ? '+' : ''}{s.summary.totalPnlR.toFixed(1)}
              </td>
              <td className="px-2 py-1 font-mono text-tv-text-muted text-[10px]">
                {formatParams(s.btParams, s.smcParams, s.dataParams)}
              </td>
              <td className="px-2 py-1">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onApply(s)}
                    className="rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-accent hover:bg-tv-accent hover:text-white"
                  >
                    Применить
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(s.id)}
                    title="Удалить"
                    className="rounded border border-tv-border px-1.5 py-0.5 text-[10px] text-tv-text-muted hover:bg-red-500 hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
