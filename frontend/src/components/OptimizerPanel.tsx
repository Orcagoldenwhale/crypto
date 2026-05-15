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
import { Play, Pause, Rocket, X, Square, Star, Trash2, Save, RotateCcw, FolderOpen } from 'lucide-react';
import type { BacktestSettings } from '@/backtest/types';
import type { SmcLayers, SmcOptions } from '@/engine/smc/types';
import type { TfPairId } from '@/types';
import { TF_PAIR_OPTIONS } from '@/data/tfPairs';
import {
  EXTENDED_CANDLE_OPTIONS,
  daysForCandles,
  type ExtendedCandleCount,
  type ExtendedProgress,
} from '@/components/BacktestPanelExtended';
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
  addHistoryEntry,
  loadHistory,
  makeId,
  removeHistoryEntry,
  slimResult,
  type RunHistoryEntry,
} from '@/optimizer/runHistory';
import {
  clearAutosave,
  loadAutosave,
  saveAutosave,
  type AutosaveEntry,
} from '@/optimizer/autosave';
import type { Combo } from '@/optimizer/generateGrid';
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
import { applySavedResult } from '@/optimizer/applySavedResult';
import { sampleRandomCombos, localNeighbors } from '@/optimizer/sampleStrategy';
import { devLog } from '@/dev/devLog';

/** Параметры умного поиска (sample + local). Подобраны эмпирически. */
const SAMPLE_SIZE = 50_000;
const LOCAL_EXPAND_TOP_K = 100;
const LOCAL_RADIUS = 1;

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
  onApplyMultiplier?: ((mult: 1 | 2 | 5 | 10 | undefined) => void) | undefined;
  /**
   * Применить TF-пару из сохранённого результата. Без этого «Применить»
   * восстанавливает только BT/SMC/tick параметры, но если saved был
   * сделан на 15m→5m а текущая пара 5m-single — overlay строится на
   * другом TF и сделки получаются ДРУГИЕ. Optional: legacy-записи до
   * 1.36.1 не имеют tfPairId, тогда callback не вызывается.
   */
  onApplyTfPair?: ((tfPairId: TfPairId) => void) | undefined;
  /**
   * Применить SMC-слои (toggle FVG/Liq/Structure/OB/BB/RB) из saved.
   * Без этого overlay считается с тем что у юзера сейчас включено,
   * НЕ с тем что было активно при создании saved → разные зоны →
   * разные сделки. Optional для legacy-записей до 1.39.2.
   */
  onApplySmcLayers?: ((layers: SmcLayers) => void) | undefined;
  /** Текущая торговая пара (например BTCUSDT) — пишется в Saved/History. */
  symbol: string;
  /** Текущая TF-пара (1h-5m / 5m-5m / …) — пишется в Saved/History. */
  tfPairId: TfPairId;
  /**
   * Колбэк после применения параметров (inline или saved). Получает финальные
   * BT-настройки. App.tsx использует его чтобы закрыть оптимизатор, открыть
   * BacktestPanel и прогнать бэктест на восстановленных условиях.
   * Без этого «Применить» только меняет state — пользователь должен вручную
   * закрыть модалку и нажать «Запустить».
   */
  onApplyComplete?: (mergedSettings: BacktestSettings) => void;
  /**
   * Текущая активная extended-выборка. null = на 7-дневном prebuilt-датасете.
   * Если выбрано (10000/25000/50000/100000) — оптимизатор крутится на этом
   * окне 5m свечей, загруженном из Vision.
   */
  currentScope: ExtendedCandleCount | null;
  /**
   * Сменить scope: грузит Vision (или берёт из кэша), потом prepareData
   * начинает отдавать новую выборку.
   */
  onChangeScope: (n: ExtendedCandleCount) => void;
  /** Идёт ли загрузка Vision для нового scope (показываем прогресс в шапке). */
  scopeLoading: boolean;
  /** Прогресс загрузки Vision — те же поля что extendedProgress в BacktestPanel. */
  scopeProgress: ExtendedProgress | null;
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
  fvgMaxLifetimeCandles: 'FVG жизнь (свечей)',
  reentryAfterWin: 'Перезаход после win',
  slBehindObWick: 'SL за фитилём OB',
  slBehindFvgEdge: 'SL за дальней границей FVG',
  slBehindSwing: 'SL за свингом',
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
  // Liquidity
  equalityTolerancePct: 'Допуск равенства цен (доля)',
  liqShowExternal: 'Liq external (за range)',
  liqShowInternal: 'Liq internal (внутри range)',
  liqShowPrevDay: 'PDH / PDL (предыдущий день)',
  liqShowCompression: 'Compression-серии',
  liqCompressionMinPoints: 'Compression: мин. точек',
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
      'minFvgPct', 'maxCandleBodyPct', 'fvgMaxLifetimeCandles',
      'reentryAfterWin', 'slBehindObWick', 'slBehindFvgEdge', 'slBehindSwing',
      'validityByMt', 'entryPoint',
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
    title: 'SMC: Liquidity / структура',
    // equalityTolerancePct влияет на свинги (lookback) → нужен для OB / RB /
    // Liquidity всегда. liq* — только при включённом Liquidity-слое.
    visible: () => true,
    keys: [
      'equalityTolerancePct',
      'liqShowExternal', 'liqShowInternal', 'liqShowPrevDay',
      'liqShowCompression', 'liqCompressionMinPoints',
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
  onApplyTfPair,
  onApplySmcLayers,
  symbol,
  tfPairId,
  onApplyComplete,
  currentScope,
  onChangeScope,
  scopeLoading,
  scopeProgress,
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
  // ===== История прогонов (localStorage) =====
  const [history, setHistory] = useState<RunHistoryEntry[]>(() => loadHistory());
  const [view, setView] = useState<'optimizer' | 'saved' | 'history'>('optimizer');

  // refs для пауза/прерывания — отдельные, чтобы пауза могла сохранить состояние.
  const pauseRef = useRef<AbortController | null>(null);
  const runStartRef = useRef<{ startedAt: number; total: number } | null>(null);

  /**
   * Снимок паузы текущей сессии. Если не null — основная кнопка "Запустить"
   * превращается в "Продолжить" и регенерирует тот же грид по специфам.
   *
   * Хранит specs (а не massive remaining[]), чтобы не плодить мусор в RAM.
   * Resume: generateGrid(specs) + runOptimizer(startIndex=processed).
   */
  const [pausedSnapshot, setPausedSnapshot] = useState<{
    processed: number;
    top: OptimizerResult[];
    historyId: string;
    total: number;
    optSettings: OptimizerSettings;
  } | null>(null);

  /**
   * Autosave-снимок, найденный при открытии оптимизатора. null = ничего не
   * сохранено / устарело / уже подобрано. Если не null — рисуется баннер
   * «Найден прерванный прогон, возобновить?».
   */
  const [autosaveEntry, setAutosaveEntry] = useState<AutosaveEntry | null>(() =>
    loadAutosave(),
  );

  /**
   * Ожидающий resume из autosave, который требует сначала переключить scope.
   * useEffect ниже срабатывает когда currentScope догнал нужное значение и
   * запускает прогон с правильным startIndex/top.
   *
   * Хранится в ref + trigger-инкременте, а не в state — иначе setState
   * внутри эффекта триггерит react-hooks/set-state-in-effect.
   */
  const pendingAutosaveResumeRef = useRef<AutosaveEntry | null>(null);
  const [pendingAutosaveResumeTrigger, setPendingAutosaveResumeTrigger] = useState(0);

  const saveResult = (r: OptimizerResult) => {
    const snap = snapshotResult(r, optSettings.metric, {
      symbol,
      tfPairId,
      smcLayers,
      currentScope,
    });
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

  /**
   * Единый путь применения: и для inline-результата (карточка top-N), и для
   * Saved-записи. Гарантирует, что TF-пара / SMC-слои / SMC-opts / BT-params /
   * tickMultiplier применяются в правильном порядке (см. applySavedResult).
   * В конце дёргает onApplyComplete с финальными BT-настройками — это сигнал
   * App.tsx закрыть оптимизатор, открыть BacktestPanel и перепрогнать.
   */
  const applySaved = (s: SavedResult) => {
    devLog('apply-saved', {
      savedId: s.id,
      savedSymbol: s.symbol ?? null,
      savedTfPairId: s.tfPairId ?? null,
      savedTickMult: s.dataParams.tickMultiplier ?? null,
      savedSmcLayers: s.smcLayers ?? null,
      currentSymbol: symbol,
      currentTfPairId: tfPairId,
      symbolMismatch: s.symbol && s.symbol !== symbol,
      tfPairMismatch: s.tfPairId && s.tfPairId !== tfPairId,
      savedScore: s.score,
      savedSummary: s.summary,
    });
    applySavedResult(s, {
      baseSettings,
      baseSmcOpts,
      currentTfPairId: tfPairId,
      onApply,
      onApplySmc,
      onApplyMultiplier,
      onApplyTfPair,
      onApplySmcLayers,
    });
    if (onApplyComplete) {
      const merged: BacktestSettings = { ...baseSettings, ...s.btParams };
      onApplyComplete(merged);
    }
  };

  /**
   * Применение inline-результата (строка таблицы top-N). Заворачиваем
   * OptimizerResult в SavedResult-обёртку через snapshotResult с ТЕКУЩИМИ
   * tfPairId / smcLayers — это правильный контекст, потому что грид крутился
   * именно на них. Дальше идём по тому же пути, что и Saved Apply.
   */
  const applyInlineResult = (r: OptimizerResult) => {
    const synthetic = snapshotResult(r, optSettings.metric, {
      symbol,
      tfPairId,
      smcLayers,
      currentScope,
    });
    applySaved(synthetic);
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

  /**
   * Смена scope (35д ↔ 87д ↔ 174д ↔ 348д) = другой датасет = другие overlay =
   * результаты прошлого прогона невалидны. Чистим results / pausedSnapshot /
   * progress, чтобы пользователь не пытался «Применить» цифры с другого окна.
   * Используем ref для отслеживания смены (не reset'аем на mount).
   */
  const prevScopeRef = useRef(currentScope);
  useEffect(() => {
    if (prevScopeRef.current === currentScope) return;
    prevScopeRef.current = currentScope;
    setResults([]);
    setPausedSnapshot(null);
    setProgress({ done: 0, total: 0, best: null });
  }, [currentScope]);

  const total = useMemo(() => countCombinations(optSettings.specs), [optSettings.specs]);

  // Умный поиск: random sample 50K → top-100 → ±1 соседи → merge.
  // Не сохраняется в OptimizerSettings (пока локальный UI-стейт):
  // в основном эта опция оправдана для гридов >100K, для маленьких
  // exhaustive проще и точнее.
  const [searchMode, setSearchMode] = useState<'exhaustive' | 'sample'>(
    total > 100_000 ? 'sample' : 'exhaustive',
  );

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

  /**
   * Запуск (новый или resume).
   *
   * resume может прийти двумя путями:
   * 1) Новая схема (paused-снимок в сессии или новые записи истории) —
   *    `specs` + `startIndex` + `initialTop`. Грид регенерируется по
   *    specs, бэктесты идут начиная с startIndex.
   * 2) Legacy-схема (старые paused-записи с remainingCombos) —
   *    `legacyCombos` + `initialTop`. Здесь грид НЕ регенерируется,
   *    а используется готовый массив remainingCombos.
   */
  const handleRun = async (resume?: {
    specs?: OptimizerSettings['specs'];
    startIndex?: number;
    legacyCombos?: Combo[];
    initialTop: OptimizerResult[];
    /** optSettings, которое надо использовать для прогона (захвачено на момент паузы). */
    capturedOptSettings?: OptimizerSettings;
    resumeId?: string;
  }) => {
    if (running) return;
    // Если есть снимок паузы в текущей сессии и явный resume не передан —
    // автоматически продолжаем с него. Это значит: после "Пауза" кнопка
    // "Запустить" работает как "Продолжить".
    if (!resume && pausedSnapshot) {
      resume = {
        specs: pausedSnapshot.optSettings.specs,
        startIndex: pausedSnapshot.processed,
        initialTop: pausedSnapshot.top,
        capturedOptSettings: pausedSnapshot.optSettings,
        resumeId: pausedSnapshot.historyId,
      };
    }
    if (!resume && total === 0) return;
    const probe = prepareData(undefined);
    if (probe.candles.length === 0) {
      window.alert('Нет данных для оптимизации — сначала загрузите свечи.');
      return;
    }

    // Используем optSettings из снимка если resume, иначе текущие.
    const effectiveOptSettings = resume?.capturedOptSettings ?? optSettings;

    // Умный поиск (только для свежих запусков, не для resume): random
    // sample → top-K → local refine. Не использует pause-resume —
    // ~30-60 секунд на ноуте, прерывание через Cancel достаточно.
    if (!resume && searchMode === 'sample' && total > SAMPLE_SIZE) {
      await runSampleMode(effectiveOptSettings);
      return;
    }

    const combos = resume?.legacyCombos
      ? resume.legacyCombos
      : generateGrid(resume?.specs ?? effectiveOptSettings.specs);
    devLog('optimizer:run-start', {
      symbol,
      tfPairId,
      mode: 'exhaustive',
      totalCombos: combos.length,
      ltfDataLen: probe.candles.length,
      first_ts: probe.candles[0]?.timestamp
        ? new Date(probe.candles[0]!.timestamp).toISOString()
        : null,
      last_ts: probe.candles[probe.candles.length - 1]?.timestamp
        ? new Date(probe.candles[probe.candles.length - 1]!.timestamp).toISOString()
        : null,
      resume: resume ? { startIndex: resume.startIndex, hasLegacy: !!resume.legacyCombos } : null,
      metric: effectiveOptSettings.metric,
      topN: effectiveOptSettings.topN,
    });
    const startIndex = resume?.legacyCombos
      ? 0
      : (resume?.startIndex ?? 0);
    const initialTop = resume?.initialTop ?? [];
    if (!resume) {
      setResults([]);
    } else {
      setResults(initialTop);
      // Переключаемся на вкладку Параметры чтобы прогресс был виден.
      setView('optimizer');
    }
    // Прогресс показывает позицию в общем гриде (включая уже пройденные при resume).
    setProgress({ done: startIndex, total: combos.length, best: null });
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;
    pauseRef.current = new AbortController();
    // react-hooks/purity flags Date.now() здесь — handleRun вызывается из
    // event handler, не из render. Реальной impurity-проблемы нет.
    // eslint-disable-next-line react-hooks/purity
    runStartRef.current = { startedAt: Date.now(), total: combos.length };

    let paused: { processed: number; top: OptimizerResult[] } | null = null;
    const startedAtForAutosave = runStartRef.current!.startedAt;
    try {
      const found = await runOptimizer({
        prepareData,
        baseSmcOpts,
        smcLayers,
        baseSettings,
        combos,
        optSettings: effectiveOptSettings,
        startIndex,
        initialTop,
        signal: ac.signal,
        pauseSignal: pauseRef.current.signal,
        onProgress: (p) => setProgress({ done: p.done, total: p.total, best: p.bestScore }),
        onPause: (snap) => { paused = snap; },
        // Каждый чекпойнт пишем autosave в localStorage — на случай краха
        // вкладки без явной паузы/завершения. На finally эта запись будет
        // снесена; останется только если функция НЕ дойдёт до finally.
        // top через slimResult — без полного массива trades в каждом отчёте,
        // иначе квота localStorage сразу кончится.
        onCheckpoint: (snap) => {
          saveAutosave({
            startedAt: startedAtForAutosave,
            updatedAt: Date.now(),
            processed: snap.processed,
            totalCombos: combos.length,
            top: snap.top.map(slimResult),
            optSettings: effectiveOptSettings,
            symbol,
            tfPairId,
            smcLayers,
            currentScope,
          });
        },
      });
      setResults(found);

      const meta = runStartRef.current!;
      devLog('optimizer:run-done', {
        symbol,
        tfPairId,
        mode: 'exhaustive',
        status: paused ? 'paused' : ac.signal.aborted ? 'cancelled' : 'completed',
        totalCombos: meta.total,
        elapsed_ms: Date.now() - meta.startedAt,
        topResultsCount: found.length,
        topScore: found[0]?.score ?? null,
        topReport: found[0]
          ? {
              trades: found[0]!.report.totalTrades,
              wins: found[0]!.report.wins,
              losses: found[0]!.report.losses,
              winRate: found[0]!.report.winRate,
              totalPnlR: found[0]!.report.totalPnlR,
            }
          : null,
      });

      if (paused) {
        const snap = paused as { processed: number; top: OptimizerResult[] };
        const newHistoryId = makeId();
        // Не сохраняем remainingCombos — для resume хватит specs+doneIndex.
        // Это критично для больших гридов: сериализация миллионов комбо
        // превышает localStorage quota.
        addHistoryAndSet({
          id: newHistoryId,
          startedAt: meta.startedAt,
          finishedAt: null,
          status: 'paused',
          optSettings: effectiveOptSettings,
          totalCombos: meta.total,
          doneIndex: snap.processed,
          results: snap.top.map(slimResult),
          symbol,
          tfPairId,
          smcLayers,
          currentScope,
        });
        // Если возобновляли — старую paused-запись удаляем (заменяем новой).
        if (resume?.resumeId) {
          setHistory((prev) => removeHistoryEntry(prev, resume.resumeId!));
        }
        // Запоминаем снимок паузы в сессии — основная кнопка станет "Продолжить".
        setPausedSnapshot({
          processed: snap.processed,
          top: snap.top,
          historyId: newHistoryId,
          total: meta.total,
          optSettings: effectiveOptSettings,
        });
      } else if (ac.signal.aborted) {
        // cancelled — сохраняем только если что-то накопили.
        if (found.length > 0) {
          addHistoryAndSet({
            id: makeId(),
            startedAt: meta.startedAt,
            finishedAt: Date.now(),
            status: 'cancelled',
            optSettings: effectiveOptSettings,
            totalCombos: meta.total,
            doneIndex: progress.done,
            results: found.map(slimResult),
            symbol,
            tfPairId,
            currentScope,
          });
        }
        // Прерванный прогон сбрасывает paused-снимок.
        setPausedSnapshot(null);
      } else {
        // completed
        addHistoryAndSet({
          id: makeId(),
          startedAt: meta.startedAt,
          finishedAt: Date.now(),
          status: 'completed',
          optSettings: effectiveOptSettings,
          totalCombos: meta.total,
          doneIndex: meta.total,
          results: found.map(slimResult),
          symbol,
          tfPairId,
          smcLayers,
          currentScope,
        });
        if (resume?.resumeId) {
          setHistory((prev) => removeHistoryEntry(prev, resume.resumeId!));
        }
        setPausedSnapshot(null);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      pauseRef.current = null;
      runStartRef.current = null;
      // Любое clean окончание (completed / paused / cancelled / throw)
      // = состояние учтено в History. Чистим autosave чтобы banner не
      // показывал «прерванный прогон» который на самом деле уже в истории.
      clearAutosave();
    }
  };

  const addHistoryAndSet = (entry: RunHistoryEntry) => {
    setHistory((prev) => addHistoryEntry(prev, entry));
  };

  /**
   * Умный поиск: двухстадийный прогон вместо exhaustive grid.
   *
   *   Stage 1: SAMPLE_SIZE случайных комбо из всего грида → top-N
   *   Stage 2: для top-LOCAL_EXPAND_TOP_K — соседи по ±LOCAL_RADIUS
   *            → объединить с initialTop из Stage 1 → финальный top-N
   *
   * Не поддерживает pause-resume (для resume нужно детерминированно
   * воспроизвести случайные индексы — без сохранённого seed невозможно).
   * Cancel работает через AbortSignal.
   */
  const runSampleMode = async (opts: OptimizerSettings) => {
    setRunning(true);
    setResults([]);
    const ac = new AbortController();
    abortRef.current = ac;
    pauseRef.current = new AbortController(); // не используется, держим для cleanup-симметрии
    const startedAt = Date.now();

    // Stage 1 — random sample.
    const samples = sampleRandomCombos(opts.specs, SAMPLE_SIZE);
    runStartRef.current = { startedAt, total: samples.length };
    setProgress({ done: 0, total: samples.length, best: null });
    const probeData = prepareData(undefined);
    devLog('optimizer:run-start', {
      symbol,
      tfPairId,
      mode: 'sample',
      sampleSize: SAMPLE_SIZE,
      localExpandTopK: LOCAL_EXPAND_TOP_K,
      localRadius: LOCAL_RADIUS,
      ltfDataLen: probeData.candles.length,
      first_ts: probeData.candles[0]?.timestamp
        ? new Date(probeData.candles[0]!.timestamp).toISOString()
        : null,
      last_ts: probeData.candles[probeData.candles.length - 1]?.timestamp
        ? new Date(probeData.candles[probeData.candles.length - 1]!.timestamp).toISOString()
        : null,
      metric: opts.metric,
      topN: opts.topN,
    });

    // Autosave НЕ пишется из sample mode. Причина: resume из autosave идёт
    // через handleRun (exhaustive путь) с generateGrid(specs) — для гридов,
    // которые попадают в sample mode (>100K combos), это материализует
    // массив на 200K-1M объектов и фризит / OOM-ит вкладку. Sample mode и
    // так быстрый (~5-15 мин на 35-87д), при крахе пользователь перезапускает
    // вручную. Если на момент старта sample был старый autosave от
    // exhaustive-прогона — чистим его, чтобы баннер не показывал чужой
    // прогон когда нынешний завершится.
    clearAutosave();

    try {
      const stage1Top = await runOptimizer({
        prepareData,
        baseSmcOpts,
        smcLayers,
        baseSettings,
        combos: samples,
        optSettings: opts,
        signal: ac.signal,
        onProgress: (p) => setProgress({ done: p.done, total: p.total, best: p.bestScore }),
      });
      if (ac.signal.aborted) {
        // Cancelled: записываем то что собрали, если есть.
        if (stage1Top.length > 0) {
          addHistoryAndSet({
            id: makeId(),
            startedAt,
            finishedAt: Date.now(),
            status: 'cancelled',
            optSettings: opts,
            totalCombos: samples.length,
            doneIndex: samples.length, // приблизительно — не критично
            results: stage1Top.map(slimResult),
            symbol,
            tfPairId,
            currentScope,
          });
        }
        setResults(stage1Top);
        return;
      }

      // Stage 2 — local refine.
      const topK = stage1Top.slice(0, LOCAL_EXPAND_TOP_K);
      const seen = new Set<string>();
      const neighborCombos: Combo[] = [];
      for (const r of topK) {
        const c: Combo = { bt: r.btParams, smc: r.smcParams, data: r.dataParams };
        for (const n of localNeighbors(c, opts.specs, LOCAL_RADIUS)) {
          const sig = JSON.stringify(n);
          if (seen.has(sig)) continue;
          seen.add(sig);
          neighborCombos.push(n);
        }
      }
      runStartRef.current = { startedAt, total: samples.length + neighborCombos.length };
      setProgress({
        done: samples.length,
        total: samples.length + neighborCombos.length,
        best: stage1Top[0]?.score ?? null,
      });

      const finalTop = await runOptimizer({
        prepareData,
        baseSmcOpts,
        smcLayers,
        baseSettings,
        combos: neighborCombos,
        optSettings: opts,
        initialTop: stage1Top,
        signal: ac.signal,
        onProgress: (p) =>
          setProgress({
            done: samples.length + p.done,
            total: samples.length + p.total,
            best: p.bestScore,
          }),
      });
      setResults(finalTop);
      devLog('optimizer:run-done', {
        symbol,
        tfPairId,
        mode: 'sample',
        status: ac.signal.aborted ? 'cancelled' : 'completed',
        stage1Combos: samples.length,
        stage2Neighbors: neighborCombos.length,
        totalCombos: samples.length + neighborCombos.length,
        elapsed_ms: Date.now() - startedAt,
        topScore: finalTop[0]?.score ?? null,
        stage1TopScore: stage1Top[0]?.score ?? null,
        scoreLiftFromStage2: finalTop[0] && stage1Top[0]
          ? (finalTop[0].score - stage1Top[0].score)
          : null,
        topReport: finalTop[0]
          ? {
              trades: finalTop[0]!.report.totalTrades,
              wins: finalTop[0]!.report.wins,
              losses: finalTop[0]!.report.losses,
              winRate: finalTop[0]!.report.winRate,
              totalPnlR: finalTop[0]!.report.totalPnlR,
            }
          : null,
      });

      addHistoryAndSet({
        id: makeId(),
        startedAt,
        finishedAt: Date.now(),
        status: ac.signal.aborted ? 'cancelled' : 'completed',
        optSettings: opts,
        totalCombos: samples.length + neighborCombos.length,
        doneIndex: samples.length + neighborCombos.length,
        results: finalTop.map(slimResult),
        symbol,
        tfPairId,
        currentScope,
      });
    } finally {
      setRunning(false);
      abortRef.current = null;
      pauseRef.current = null;
      runStartRef.current = null;
      clearAutosave();
    }
  };

  const handlePause = () => {
    if (!running) return;
    pauseRef.current?.abort();
  };

  /**
   * Запустить прогон из autosave-записи. Используется и при «scope совпадает —
   * запускай сразу», и при «scope догнал нужное значение через useEffect ниже».
   */
  const startAutosaveResume = (entry: AutosaveEntry) => {
    setAutosaveEntry(null);
    setOptSettings(entry.optSettings);
    handleRun({
      specs: entry.optSettings.specs,
      startIndex: entry.processed,
      initialTop: entry.top,
      capturedOptSettings: entry.optSettings,
    });
  };

  /**
   * Кнопка «Возобновить» на autosave-баннере. Если текущий scope не совпадает
   * с тем, что был при прерванном прогоне — заказываем переключение через
   * onChangeScope и ждём в useEffect ниже. Если совпадает — запускаем сразу.
   */
  const handleResumeAutosave = () => {
    if (!autosaveEntry) return;
    // Защита от freeze'а на гигантских гридах. handleRun (resume-путь) зовёт
    // generateGrid(specs) — он материализует ВЕСЬ грид в массив. Для гридов
    // >SAMPLE_SIZE (200K-1M комбо) это OOM/фриз. Такие autosave-записи могут
    // оставаться у юзеров, у которых 1.45.0 успел записать сэмпл-прогон до
    // 1.45.1 (где autosave из sample mode отключён).
    const expectedCombos = countCombinations(autosaveEntry.optSettings.specs);
    if (expectedCombos > SAMPLE_SIZE) {
      const ok = window.confirm(
        `Прогон содержит ~${expectedCombos.toLocaleString('ru-RU')} комбинаций — это sample-mode грид, его нельзя точно возобновить (sample-комбо случайные, нет детерминированного индекса). Удалить запись и начать с чистого листа?`,
      );
      if (ok) handleDiscardAutosave();
      return;
    }
    if (autosaveEntry.currentScope === currentScope) {
      startAutosaveResume(autosaveEntry);
      return;
    }
    if (autosaveEntry.currentScope === null) {
      // Сохранение было на 7д prebuilt, а сейчас extended активен. Reset
      // обычно не перезагружает 7д-данные, поэтому без явного действия
      // получится несовпадение — предупреждаем юзера, пусть закроет
      // extended-режим в BacktestPanel вручную.
      window.alert(
        'Прерванный прогон был на 7-дневном датасете, а сейчас активна extended-выборка. Сначала вернись к 7д через BacktestPanel.',
      );
      return;
    }
    // Заказываем смену scope; useEffect ниже подхватит и запустит когда
    // загрузка Vision закончится. Ref + trigger чтобы не плодить state в effect.
    pendingAutosaveResumeRef.current = autosaveEntry;
    setPendingAutosaveResumeTrigger((t) => t + 1);
    setAutosaveEntry(null);
    onChangeScope(autosaveEntry.currentScope as ExtendedCandleCount);
  };

  /** «Удалить» на баннере — забываем прерванный прогон. */
  const handleDiscardAutosave = () => {
    setAutosaveEntry(null);
    clearAutosave();
  };

  /**
   * Ждём пока currentScope догонит требуемый у pendingAutosaveResumeRef, потом
   * запускаем. Срабатывает после успешной загрузки Vision из onChangeScope.
   * Trigger-стейт инкрементируется в handleResumeAutosave; здесь читаем ref
   * и мутируем его (не setState — иначе react-hooks/set-state-in-effect).
   */
  useEffect(() => {
    if (pendingAutosaveResumeTrigger === 0) return;
    const entry = pendingAutosaveResumeRef.current;
    if (!entry) return;
    if (scopeLoading) return;
    if (currentScope !== entry.currentScope) return;
    pendingAutosaveResumeRef.current = null;
    startAutosaveResume(entry);
    // startAutosaveResume и currentScope из замыкания — остальное читается
    // в момент запуска.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutosaveResumeTrigger, scopeLoading, currentScope]);

  /** Загружает запись истории в основную вкладку (без запуска). */
  const openHistoryEntry = (e: RunHistoryEntry) => {
    setOptSettings(e.optSettings);
    setResults(e.results);
    setProgress({ done: e.doneIndex, total: e.totalCombos, best: e.results[0]?.score ?? null });
    setView('optimizer');
  };

  /** Загружает + сразу возобновляет прогон. */
  const resumeHistoryEntry = (e: RunHistoryEntry) => {
    if (e.status !== 'paused') {
      window.alert('Запись не на паузе — возобновить нельзя.');
      return;
    }
    setOptSettings(e.optSettings);
    // Legacy: записи до v1.36 хранили полный массив remainingCombos.
    if (e.remainingCombos && e.remainingCombos.length > 0) {
      handleRun({
        legacyCombos: e.remainingCombos,
        initialTop: e.results,
        capturedOptSettings: e.optSettings,
        resumeId: e.id,
      });
      return;
    }
    // Новая схема: регенерируем грид из specs + skip до doneIndex.
    handleRun({
      specs: e.optSettings.specs,
      startIndex: e.doneIndex,
      initialTop: e.results,
      capturedOptSettings: e.optSettings,
      resumeId: e.id,
    });
  };

  const deleteHistoryEntry = (id: string) => {
    setHistory((prev) => removeHistoryEntry(prev, id));
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
              <button
                type="button"
                onClick={() => setView('history')}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  view === 'history'
                    ? 'bg-tv-accent text-white'
                    : 'text-tv-text-muted hover:text-tv-text'
                }`}
              >
                История ({history.length})
              </button>
            </div>
            {/* Окно (scope) — выборка, на которой крутится оптимизатор. */}
            {view === 'optimizer' && (
              <label
                className="flex items-center gap-1.5 text-[10px] text-tv-text-muted"
                title={
                  currentScope === null
                    ? 'Сейчас 7д prebuilt. Выбери 35д+ → подгрузится Vision, оптимизатор будет крутиться на этом окне.'
                    : 'Текущая выборка из Vision. Поменяй чтобы переключиться (кэш переиспользуется).'
                }
              >
                Окно
                <select
                  value={currentScope === null ? 'current' : String(currentScope)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'current') return;
                    onChangeScope(Number(v) as ExtendedCandleCount);
                  }}
                  disabled={running || scopeLoading}
                  className="rounded border border-tv-border bg-tv-bg-deep px-1 py-0.5 text-[10px] text-tv-text outline-none focus:border-tv-accent disabled:opacity-40"
                >
                  {currentScope === null && (
                    <option value="current">7д (текущий)</option>
                  )}
                  {EXTENDED_CANDLE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {daysForCandles(n)}д ({n.toLocaleString('ru-RU')})
                    </option>
                  ))}
                </select>
                {scopeLoading && (
                  <span className="text-[9px] text-amber-400">
                    {scopeProgress?.label ?? 'загрузка…'}
                  </span>
                )}
              </label>
            )}

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
        ) : view === 'history' ? (
          <HistoryView
            items={history}
            onOpen={openHistoryEntry}
            onResume={resumeHistoryEntry}
            onDelete={deleteHistoryEntry}
          />
        ) : (
          <>
        {/* Autosave-баннер: если в localStorage есть прерванный прогон без
            явной паузы/завершения — предлагаем возобновить. После клика
            «Возобновить» (или закрытия баннера через «Удалить») — пропадает. */}
        {autosaveEntry && (
          <div className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-amber-100">
                <strong>Найден прерванный прогон.</strong>{' '}
                Обработано {autosaveEntry.processed.toLocaleString('ru-RU')} /{' '}
                {autosaveEntry.totalCombos.toLocaleString('ru-RU')} ({Math.round(
                  (autosaveEntry.processed / Math.max(1, autosaveEntry.totalCombos)) * 100,
                )}%), метрика «{METRIC_LABEL[autosaveEntry.optSettings.metric]}».{' '}
                {autosaveEntry.currentScope !== null &&
                  `Окно ${autosaveEntry.currentScope.toLocaleString('ru-RU')} свечей.`}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handleResumeAutosave}
                  disabled={running || scopeLoading}
                  className="flex items-center gap-1 rounded bg-tv-accent px-3 py-1 text-[11px] font-semibold text-white hover:bg-tv-accent-hover disabled:opacity-40"
                  title="Регенерируем грид по сохранённым specs и стартуем с того же индекса"
                >
                  <Play className="h-3 w-3" />
                  Возобновить
                </button>
                <button
                  type="button"
                  onClick={handleDiscardAutosave}
                  className="rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-[11px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                  title="Забыть прогон, начать с чистого листа"
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>
        )}

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
                    Всего комбинаций: <strong className="text-tv-accent">{total === Infinity ? '∞' : total.toLocaleString('ru-RU')}</strong>
                    {searchMode === 'sample' && total > SAMPLE_SIZE && (
                      <span className="ml-1 text-[10px] text-tv-text-muted">
                        (сэмпл {SAMPLE_SIZE.toLocaleString('ru-RU')} + ~{LOCAL_EXPAND_TOP_K * 20} соседей)
                      </span>
                    )}
                  </span>
                  {total > 10000 && searchMode === 'exhaustive' && (
                    <span className="text-[10px] text-amber-400">
                      Большой объём — может занять время. Можно прервать.
                    </span>
                  )}
                </div>
                <label
                  className="mb-2 flex cursor-pointer items-center justify-between gap-2 rounded border border-tv-border bg-tv-bg-deep/40 px-2 py-1 text-[11px]"
                  title="Sample 50K случайных + локальный refine вокруг top-100. Для больших гридов (>100K) — 100× быстрее exhaustive при ~95% recall на top-N."
                >
                  <span className="text-tv-text">
                    Умный поиск
                    <span className="ml-1 text-tv-text-muted">
                      (для гридов &gt; {SAMPLE_SIZE.toLocaleString('ru-RU')})
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={searchMode === 'sample'}
                    onChange={(e) => setSearchMode(e.target.checked ? 'sample' : 'exhaustive')}
                    disabled={running}
                    className="h-3.5 w-3.5 accent-tv-accent"
                  />
                </label>
                {!running ? (
                  pausedSnapshot ? (
                    <div className="flex w-full gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRun()}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded bg-tv-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-tv-accent-hover"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Продолжить ({pausedSnapshot.processed} / {pausedSnapshot.total})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Сбросить паузу и начать оптимизацию заново?')) {
                            setPausedSnapshot(null);
                          }
                        }}
                        title="Сбросить паузу и запустить новый прогон с нуля"
                        className="flex shrink-0 items-center justify-center gap-1 rounded border border-tv-border px-2 py-1.5 text-xs text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Заново
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRun()}
                      disabled={total === 0 || scopeLoading}
                      className="flex w-full items-center justify-center gap-1.5 rounded bg-tv-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-tv-accent-hover disabled:opacity-40"
                      title={scopeLoading ? 'Дождитесь загрузки Vision для выбранного окна' : undefined}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {scopeLoading ? 'Грузим данные…' : 'Запустить оптимизацию'}
                    </button>
                  )
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
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={handlePause}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded border border-tv-border bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20"
                        title="Сохранить прогон в Историю и остановить (можно возобновить позже)"
                      >
                        <Pause className="h-3 w-3" />
                        Пауза
                      </button>
                      <button
                        type="button"
                        onClick={() => abortRef.current?.abort()}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded border border-tv-border px-2 py-1 text-[11px] text-tv-text-dim hover:text-white"
                        title="Прервать прогон (без возможности возобновить)"
                      >
                        <Square className="h-3 w-3" />
                        Прервать
                      </button>
                    </div>
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
                onApplyResult={applyInlineResult}
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
  onApplyResult,
  onSave,
}: {
  results: readonly OptimizerResult[];
  metric: OptimizerMetric;
  /** Унифицированный путь применения — TF/layers/smc/bt/tick + auto-rerun. */
  onApplyResult: (r: OptimizerResult) => void;
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
            onApplyResult={onApplyResult}
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
  onApplyResult,
  onSave,
}: {
  idx: number;
  result: OptimizerResult;
  onApplyResult: (r: OptimizerResult) => void;
  onSave: (r: OptimizerResult) => void;
}) {
  const { report, btParams, smcParams, dataParams, score } = result;
  const handleApply = () => onApplyResult(result);
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
            <th className="px-2 py-1 text-left">Источник</th>
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
              <td className="px-2 py-1 text-tv-text-muted whitespace-nowrap">
                {joinSourceParts([
                  s.symbol ?? null,
                  tfPairLabel(s.tfPairId),
                  formatScope(s.currentScope),
                  formatTickFromSaved(s),
                ])}
              </td>
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

/**
 * Подпись «Источник» для строки в Saved/History.
 *   - symbol — например BTCUSDT (если есть)
 *   - tfPair — `15m → 5m` (multi-TF), `5m (single)` и т.п.
 *   - tick — для Saved одно значение (`×N`); для History — перечисление значений
 *     если параметр варьировался (`×1, ×2, ×5`) или одно значение если фиксирован.
 * Single/multi относится к ТАЙМФРЕЙМУ (зашито в подпись TF-пары), не к tick.
 * Старые записи без этих полей показывают прочерк, чтобы строка не была пустой.
 */
function tfPairLabel(id: string | undefined): string | null {
  if (!id) return null;
  const opt = TF_PAIR_OPTIONS.find((o) => o.id === id);
  return opt ? opt.label : id;
}

function formatTickFromSaved(s: SavedResult): string | null {
  const m = s.dataParams.tickMultiplier;
  return typeof m === 'number' ? `×${m}` : null;
}

function formatTickFromHistory(e: RunHistoryEntry): string | null {
  const spec = e.optSettings?.specs?.tickMultiplier;
  if (!spec || spec.type !== 'enum' || !spec.enabled) return null;
  const vs = spec.values;
  if (vs.length === 0) return null;
  return vs.map((v) => `×${v}`).join(', ');
}

/**
 * Окно прогона: null = 7д prebuilt, число = extended candle count.
 * Возвращает null если поле вообще отсутствует (legacy запись до 1.45.2) —
 * чтобы не показывать «?» рядом с реальными данными.
 */
function formatScope(scope: number | null | undefined): string | null {
  if (scope === undefined) return null;
  if (scope === null) return '7д';
  return `${daysForCandles(scope)}д`;
}

function joinSourceParts(parts: ReadonlyArray<string | null>): string {
  const filtered = parts.filter((p): p is string => !!p);
  return filtered.length > 0 ? filtered.join(' · ') : '—';
}

// ============================================================================
// История прогонов (вкладка)
// ============================================================================

const STATUS_LABEL: Record<RunHistoryEntry['status'], string> = {
  completed: '✅ Завершён',
  paused: '⏸ Пауза',
  cancelled: '⛔ Прерван',
};

function HistoryView({
  items,
  onOpen,
  onResume,
  onDelete,
}: {
  items: readonly RunHistoryEntry[];
  onOpen: (e: RunHistoryEntry) => void;
  onResume: (e: RunHistoryEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-xs text-tv-text-muted">
          Здесь сохраняется история всех прогонов оптимизатора. Каждый прогон
          (завершённый, на паузе или прерванный) попадает сюда автоматически.
          Можно открыть, чтобы посмотреть результаты, или возобновить прерванный.
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
            <th className="px-2 py-1 text-left">Источник</th>
            <th className="px-2 py-1 text-left">Статус</th>
            <th className="px-2 py-1 text-right">Прогресс</th>
            <th className="px-2 py-1 text-left">Метрика</th>
            <th className="px-2 py-1 text-right">Top score</th>
            <th className="px-2 py-1 text-right">Сделок</th>
            <th className="px-2 py-1 text-right">W/L</th>
            <th className="px-2 py-1 text-right">P&L (R)</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => {
            const best = e.results[0];
            const pct = e.totalCombos > 0
              ? Math.round((e.doneIndex / e.totalCombos) * 100)
              : 0;
            return (
              <tr key={e.id} className="border-t border-tv-border/40 hover:bg-tv-panel-hover">
                <td className="px-2 py-1 text-tv-text-muted">{formatDate(e.startedAt)}</td>
                <td className="px-2 py-1 text-tv-text-muted whitespace-nowrap">
                  {joinSourceParts([
                    e.symbol ?? null,
                    tfPairLabel(e.tfPairId),
                    formatScope(e.currentScope),
                    formatTickFromHistory(e),
                  ])}
                </td>
                <td className="px-2 py-1 text-tv-text">{STATUS_LABEL[e.status]}</td>
                <td className="px-2 py-1 text-right font-mono text-tv-text-muted">
                  {e.doneIndex}/{e.totalCombos} ({pct}%)
                </td>
                <td className="px-2 py-1 text-tv-text-muted">{METRIC_LABEL[e.optSettings.metric]}</td>
                <td className="px-2 py-1 text-right font-mono text-tv-accent">
                  {best ? formatScore(best.score) : '—'}
                </td>
                <td className="px-2 py-1 text-right font-mono">{best ? best.report.totalTrades : '—'}</td>
                <td className="px-2 py-1 text-right font-mono">
                  {best
                    ? (
                      <>
                        <span className="text-tv-up">{best.report.wins}</span>/
                        <span className="text-tv-down">{best.report.losses}</span>
                      </>
                    )
                    : '—'}
                </td>
                <td className={`px-2 py-1 text-right font-mono ${best && best.report.totalPnlR >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>
                  {best ? `${best.report.totalPnlR >= 0 ? '+' : ''}${best.report.totalPnlR.toFixed(1)}` : '—'}
                </td>
                <td className="px-2 py-1">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      title="Открыть конфигурацию и результаты в основной вкладке"
                      className="flex items-center gap-1 rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-text-muted hover:bg-tv-panel-hover hover:text-tv-text"
                    >
                      <FolderOpen className="h-3 w-3" />
                      Открыть
                    </button>
                    {e.status === 'paused' && e.remainingCombos && e.remainingCombos.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onResume(e)}
                        title="Возобновить прогон с момента паузы"
                        className="flex items-center gap-1 rounded border border-tv-border bg-tv-accent/20 px-2 py-0.5 text-[10px] text-tv-accent hover:bg-tv-accent hover:text-white"
                      >
                        <Play className="h-3 w-3" />
                        Возобновить
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(e.id)}
                      title="Удалить запись"
                      className="rounded border border-tv-border px-1.5 py-0.5 text-[10px] text-tv-text-muted hover:bg-red-500 hover:text-white"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
