import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { Toolbox, type Tool } from '@/components/Toolbox';
import { TickPicker } from '@/components/TickPicker';
import { StatusBar } from '@/components/StatusBar';
import {
  ChartCanvas,
  type ChartViewportApi,
  type HoveredClusterInfo,
} from '@/components/ChartCanvas';
import { ZoneMenu } from '@/components/ZoneMenu';
import { ScannerReport } from '@/components/ScannerReport';
import { TradeDetailPanel } from '@/components/TradeDetailPanel';
import { ClusterTooltip } from '@/components/ClusterTooltip';
import { DropOverlay } from '@/components/DropOverlay';
import { TfPairSelector } from '@/components/TfPairSelector';
import { generateMockData } from '@/data/mockGenerator';
import {
  aggregateTo15m,
  aggregateTo1h,
  aggregate5mTo15mLtf,
  aggregate5mTo1hLtf,
} from '@/data/aggregator';
import { fetchBinanceKlines } from '@/data/binanceLoader';
import { fetchVisionDataset, type ProgressInfo } from '@/data/visionLoader';
import { loadDatasetFromFile, loadDatasetFromUrl } from '@/data/datasetLoader';
import { loadPOIs, savePOIs, loadExtendedDataset, saveExtendedDataset } from '@/data/storage';
import { devLog, devLogClear } from '@/dev/devLog';
import {
  createLiveCandleManager,
  type LiveCandleManager,
  type LiveDebugStats,
} from '@/data/liveCandleManager';
import { mergeRaw5mWithLive, mergeRaw5mWithKlines } from '@/data/liveHistoryMerge';
import { fetchRecentKlines5m } from '@/data/binanceRecentKlines';
import { dedupeZones } from '@/data/dedupeZones';
import { findSymbol } from '@/data/symbols';
import {
  loadSymbol,
  saveSymbol,
  loadTickPref,
  saveTickPref,
  type TickPref,
} from '@/data/tickPreference';
import { loadTfPairId, saveTfPairId } from '@/data/tfPairPreference';
import { chartTfsForPair, isSingleTfPair } from '@/data/tfPairs';
import {
  loadSmcLayers,
  loadSmcOptions,
  saveSmcLayers,
  saveSmcOptions,
} from '@/data/smcPreference';
import { runSmcAnalysis } from '@/engine/smc';
import { EMPTY_SMC_OVERLAY, type SmcLayers, type SmcOptions } from '@/engine/smc/types';
import { SmcSettingsPopover } from '@/components/SmcSettingsPopover';
import { BacktestPanel } from '@/components/BacktestPanel';
import {
  daysForCandles,
  type ExtendedCandleCount,
  type ExtendedProgress,
} from '@/components/BacktestPanelExtended';
import { OptimizerPanel } from '@/components/OptimizerPanel';
import { HelpModal } from '@/components/HelpModal';
import { runBacktest, collectZones, type SmcZoneRect } from '@/backtest/runBacktest';
import type { BacktestSettings, BacktestReport as BacktestReportData } from '@/backtest/types';
import { DEFAULT_BACKTEST_SETTINGS } from '@/backtest/types';
import { candleDurationMs } from '@/engine/scale';
import {
  computeAutoMultiplier,
  regroupCandles,
  type TickMultiplier,
} from '@/engine/regroupClusters';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useUndoStack } from '@/hooks/useUndoStack';
import { useDropZone } from '@/hooks/useDropZone';
import type { DraftZoneCoords } from '@/engine/poi';
import type {
  Candle5m,
  Candle15m,
  Candle1h,
  LiveStatus,
  POIZone,
  ScannerReport as ScannerReportData,
  Signal,
  Timeframe,
  TfPairId,
} from '@/types';
import type {
  ScannerWorkerRequest,
  ScannerWorkerResponse,
} from '@/scanner/scannerWorker';
import { runScanner as runScannerSync } from '@/scanner/runScanner';

/** Сколько свечей LTF слева/справа при «перейти на младший» из зоны. */
const LTF_CONTEXT_CANDLES = 9;
/** Полуокно вокруг сигнала при фокусе (в свечах LTF с каждой стороны). */
const SIGNAL_FOCUS_HALF_CANDLES = 6;

type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; loaded: number; total: number; label: string }
  | { kind: 'success'; source: 'vision' | 'klines' | 'mock' | 'file'; message: string }
  | { kind: 'error'; message: string };

interface ZoneMenuState {
  zoneId: string;
  x: number;
  y: number;
}

interface ScannerState {
  report: ScannerReportData;
  elapsedMs: number;
  isExploreMode: boolean;
}

/**
 * Описание операции с зонами для undo/redo стека.
 * Поле `zone` хранит копию данных зоны на момент операции,
 * чтобы revert/apply работали даже если родительский state изменился.
 */
type ZoneAction =
  | { kind: 'create'; zone: POIZone }
  | { kind: 'delete'; zone: POIZone }
  | { kind: 'clear'; zones: POIZone[]; signals: Signal[] };

export default function App() {
  /** Пара «старший → младший» (зоны на старшем, сканер на младшем). */
  const [tfPairId, setTfPairId] = useState<TfPairId>(() => loadTfPairId());
  /**
   * `isSingleTf` — вычисляется чистой функцией без useMemo, чтобы быть
   * доступной во всех useEffect выше блока useMemo с timeframe-данными.
   * Стоимость вызова — пара сравнений строк.
   */
  const isSingleTf = isSingleTfPair(tfPairId);
  /**
   * Какой график сейчас на экране:
   *   'htf'    — старший ТФ (только разметка зон),
   *   'ltf'    — младший ТФ (сканер, маркеры, footprint),
   *   'single' — один ТФ для всего (зоны + сканер на одной оси, выбрано в TfPairSelector).
   *
   * При single-режиме переключатель экрана HTF/LTF скрыт.
   * Начальное значение синхронизировано с восстановленной парой ТФ.
   */
  const [chartView, setChartView] = useState<'htf' | 'ltf' | 'single'>(() =>
    isSingleTfPair(tfPairId) ? 'single' : 'htf',
  );
  const [tool, setTool] = useState<Tool>('pointer');
  // Симвoл и tick-настройка читаются из localStorage один раз при инициализации.
  // Дальше вся синхронизация — через onChange-колбэки + useEffect ниже.
  const [symbol, setSymbol] = useState<string>(() => loadSymbol());
  const [tickPref, setTickPref] = useState<TickPref>(() => loadTickPref());
  /**
   * «Сырые» свечи 5m из датасета — ДО регруппировки.
   * Регруппировка идёт ниже через useMemo (regroupCandles), чтобы не плодить
   * лишние ре-рендеры при смене tick × N — ядро датасета остаётся неизменным.
   */
  const [rawData5m, setRawData5m] = useState<Candle5m[]>([]);
  const [zones, setZones] = useState<POIZone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [zoneMenu, setZoneMenu] = useState<ZoneMenuState | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [scanner, setScanner] = useState<ScannerState | null>(null);
  const [scannerRunning, setScannerRunning] = useState(false);
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });
  /** Свеча под курсором — для StatusBar. */
  const [hoveredCandle, setHoveredCandle] = useState<
    Candle5m | Candle15m | Candle1h | null
  >(null);
  /** Кластер под курсором — для тултипа. Обновляется на каждом mousemove. */
  const [hoveredClusterInfo, setHoveredClusterInfo] = useState<HoveredClusterInfo | null>(
    null,
  );
  /** SMC: видимость слоёв (FVG / Liquidity) — восстанавливаем из localStorage. */
  const [smcLayers, setSmcLayers] = useState<SmcLayers>(() => loadSmcLayers());
  /** SMC: параметры детекторов (lookback, tolerance, hideMitigated). */
  const [smcOpts, setSmcOpts] = useState<SmcOptions>(() => loadSmcOptions());
  /** Координаты «якоря» popover'а настроек SMC; null — закрыт. */
  const [smcSettingsAnchor, setSmcSettingsAnchor] = useState<
    { x: number; y: number } | null
  >(null);
  /** Открыто ли полное руководство (HelpModal). */
  const [helpOpen, setHelpOpen] = useState(false);

  // ============================================================================
  // Бэктест
  // ============================================================================
  const [backtestOpen, setBacktestOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const [backtestReport, setBacktestReport] = useState<BacktestReportData | null>(null);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestZones, setBacktestZones] = useState<SmcZoneRect[]>([]);
  const [backtestSettings, setBacktestSettings] = useState<BacktestSettings>(DEFAULT_BACKTEST_SETTINGS);

  // Расширенный бэктест — отдельное состояние, не пересекается с обычным.
  // Данные загружаются по запросу, кэшируются в ref'е по ключу symbol+days+mult.
  const [extendedReport, setExtendedReport] = useState<BacktestReportData | null>(null);
  const [extendedRunning, setExtendedRunning] = useState(false);
  const [extendedProgress, setExtendedProgress] = useState<ExtendedProgress | null>(null);
  const [extendedCandleCount, setExtendedCandleCount] = useState<ExtendedCandleCount | null>(null);
  const extendedAbortRef = useRef<AbortController | null>(null);
  const extendedCacheRef = useRef<Map<string, readonly Candle5m[]>>(new Map());

  // ============================================================================
  // Live-режим (real-time aggTrades с Binance, см. docs/04-live-mode.md)
  // ============================================================================
  /** Включён ли real-time стрим прямо сейчас. */
  const [liveActive, setLiveActive] = useState(false);
  /** Текущий статус live-машины (для бэйджа в шапке). */
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle');
  /** Закрытые свечи, пришедшие из live-стрима — добавляются к историческим. */
  const [liveClosedCandles, setLiveClosedCandles] = useState<Candle5m[]>([]);
  /** Текущая ещё-не-закрытая свеча (на rightmost краю графика). */
  const [liveOpenCandle, setLiveOpenCandle] = useState<Candle5m | null>(null);
  /**
   * Диагностика live-стрима в реальном времени (счётчик тиков, последний тик и т.д.).
   * Обновляется раз в секунду из liveCandleManager.getDebugStats(). Передаётся в
   * Header — пользователь видит, идут ли тики из WS, без открытия DevTools.
   */
  const [liveStats, setLiveStats] = useState<LiveDebugStats | null>(null);
  /** Хендл менеджера live (создаём при включении, уничтожаем при выключении). */
  const liveManagerRef = useRef<LiveCandleManager | null>(null);
  /**
   * Запоминаем символ, на котором запустили live, чтобы при смене символа
   * корректно остановить поток (не подключаемся к старому символу).
   */
  const liveSymbolRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const viewportApiRef = useRef<ChartViewportApi | null>(null);
  const scannerWorkerRef = useRef<Worker | null>(null);
  // Зеркалит scannerRunning, но всегда актуально внутри setTimeout-замыкания.
  // (state-переменная захватывается на момент создания таймера и устаревает.)
  const scannerRunningRef = useRef(false);

  // ============================================================================
  // Undo/Redo стек для операций с зонами.
  // Payload типа `ZoneAction` — компактное описание операции для отладки;
  // вся реальная работа делается через apply/revert замыкания.
  //
  // canUndo/canRedo — это функции (стек хранится в useRef и НЕ реактивен).
  // Чтобы кнопки в Toolbox обновлялись (enable/disable), бампаем версию
  // истории на каждой push/undo/redo операции и читаем canUndo/canRedo() в
  // зависимости от этой версии.
  // ============================================================================
  const undoStackRaw = useUndoStack<ZoneAction>();
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoStack = useMemo(
    () => ({
      push: (a: Parameters<typeof undoStackRaw.pushAction>[0]) => {
        undoStackRaw.pushAction(a);
        setHistoryVersion((v) => v + 1);
      },
      undo: () => {
        if (undoStackRaw.undo()) setHistoryVersion((v) => v + 1);
      },
      redo: () => {
        if (undoStackRaw.redo()) setHistoryVersion((v) => v + 1);
      },
    }),
    [undoStackRaw],
  );
  // historyVersion в зависимостях не нужен — мы читаем canUndo/canRedo
  // на каждом рендере, а рендер триггерится самим инкрементом версии.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canUndo = useMemo(() => undoStackRaw.canUndo(), [undoStackRaw, historyVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const canRedo = useMemo(() => undoStackRaw.canRedo(), [undoStackRaw, historyVersion]);
  const handleViewportApi = useCallback((api: ChartViewportApi) => {
    viewportApiRef.current = api;
  }, []);

  // Колбэки для hover-эффектов. Стабильные — не пересоздаются на каждый рендер,
  // иначе ChartCanvas будет переподписывать слушатели mousemove на ровном месте.
  const handleHoverCandle = useCallback(
    (c: Candle5m | Candle15m | Candle1h | null) => setHoveredCandle(c),
    [],
  );
  const handleHoverCluster = useCallback(
    (info: HoveredClusterInfo | null) => setHoveredClusterInfo(info),
    [],
  );

  // ============================================================================
  // Persistence: загрузка зон из IndexedDB при смене символа.
  //
  // Зоны хранятся per-symbol — у пользователя на BTC своя разметка, на ETH своя.
  // Дедупликация: в IndexedDB могут лежать дубли из старых билдов (баг с
  // двойным срабатыванием setState updater в Strict Mode, починен в 1.11.1).
  // Считаем дублями зоны с одинаковыми временными И ценовыми границами.
  // ============================================================================
  useEffect(() => {
    let cancelled = false;
    loadPOIs(symbol).then((restored) => {
      if (cancelled) return;
      // ВАЖНО: даже пустой массив должен примениться — иначе при переключении
      // на новый символ останутся зоны старого.
      const deduped = dedupeZones(restored);
      if (deduped.length < restored.length) {
        console.info(
          `[storage] убрано ${restored.length - deduped.length} зон-дублей при загрузке (${symbol})`,
        );
      }
      setZones(deduped);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // ============================================================================
  // Авто-загрузка предзагруженного датасета при смене symbol.
  //
  // Каждый символ имеет свой prebuiltUrl (см. data/symbols.ts). При смене
  // тикера ChartCanvas ненадолго становится пустым → подтягивается новый файл.
  // 404 — норма (датасета нет), молчим. Любые ошибки сети — warn в консоль.
  // ============================================================================
  useEffect(() => {
    const info = findSymbol(symbol);
    if (!info) return;

    let cancelled = false;
    const ac = new AbortController();
    // setState ниже сбрасывают stale-данные предыдущего символа — это и есть
    // синхронизация с внешним идентификатором (symbol). React 19's
    // `react-hooks/set-state-in-effect` ругается на любой setState в useEffect,
    // но именно этот сценарий — корректный.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus({
      kind: 'loading',
      loaded: 0,
      total: 1,
      label: `Загрузка ${info.short}/USDT…`,
    });
    // Сбрасываем то, что относилось к ПРЕДЫДУЩЕМУ символу — чтобы не показать
    // несовпадающие данные на полсекунды при переключении.
    setRawData5m([]);
    setSignals([]);
    setSelectedSignalId(null);
    setScanner(null);

    (async () => {
      try {
        const ds = await loadDatasetFromUrl(info.prebuiltUrl, ac.signal);
        if (cancelled) return;
        const ltf = ds.candles;
        setRawData5m(ltf);
        setStatus({
          kind: 'success',
          source: 'file',
          message: `${info.short}/USDT: ${ltf.length} × 5m (${ds.meta.from.slice(0, 10)} … ${ds.meta.to.slice(0, 10)})`,
        });
        // Reset viewport, чтобы цена нового инструмента отрисовалась корректно.
        requestAnimationFrame(() => {
          viewportApiRef.current?.resetView();
        });
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return;
        const msg = (e as Error).message ?? '';
        if (/HTTP 404/.test(msg)) {
          // Тихий случай — файла просто нет.
          setStatus({ kind: 'idle' });
        } else {
          console.warn('[prebuilt] не удалось загрузить', info.prebuiltUrl, e);
          setStatus({
            kind: 'error',
            message: `Не удалось загрузить ${info.short}/USDT: ${msg}`,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [symbol]);

  // Сохраняем зоны при каждом изменении (idb достаточно быстр для синхронной записи).
  // Skip первого рендера для каждого symbol, чтобы пустой массив не затёр загруженный.
  const lastSavedSymbolRef = useRef<string | null>(null);
  useEffect(() => {
    // Первый эффект для каждого нового symbol — пропускаем, чтобы загруженные
    // из IndexedDB зоны не затёрлись пустым массивом state'а.
    if (lastSavedSymbolRef.current !== symbol) {
      lastSavedSymbolRef.current = symbol;
      return;
    }
    void savePOIs(symbol, zones);
  }, [symbol, zones]);

  // Persistence симвoла и tick preference (отдельный эффект, чтобы не смешивать
  // с side-effect'ом загрузки данных).
  useEffect(() => {
    saveSymbol(symbol);
  }, [symbol]);
  useEffect(() => {
    saveTickPref(tickPref);
  }, [tickPref]);
  // Persistence SMC-настроек.
  useEffect(() => {
    saveSmcLayers(smcLayers);
  }, [smcLayers]);
  useEffect(() => {
    saveSmcOptions(smcOpts);
  }, [smcOpts]);

  /**
   * Смена пары ТФ.
   *
   * - Двухуровневая пара → возвращаем экран в 'htf' (там разметка).
   * - Single-пара → ставим chartView = 'single' (один экран на всё).
   * Также сбрасываем сигналы/сканер, потому что их свечи перестают совпадать
   * с новой шкалой. На первом маунте (восстановление выбора из localStorage)
   * сброс пропускаем, чтобы не терять начальные зоны.
   */
  const tfPairMountRef = useRef(true);
  useEffect(() => {
    if (tfPairMountRef.current) {
      tfPairMountRef.current = false;
      // На первом маунте только синхронизируем chartView с типом пары —
      // если пользователь раньше сохранил single-пару, мы должны открыть
      // экран в режиме 'single', а не 'htf'.
      setChartView(isSingleTf ? 'single' : 'htf');
      return;
    }
    setChartView(isSingleTf ? 'single' : 'htf');
    setTool('pointer');
    setZoneMenu(null);
    setSignals([]);
    setSelectedSignalId(null);
    setScanner(null);
    requestAnimationFrame(() => viewportApiRef.current?.resetView());
  }, [tfPairId, isSingleTf]);

  // ============================================================================
  // Очистка предыдущего HTTP-запроса при размонтировании
  // ============================================================================
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // ============================================================================
  // Регруппировка кластеров под выбранный tick × N.
  //
  // `autoMultiplier` пересчитывается ОДИН РАЗ на загрузку датасета —
  // не на каждый рендер. `effectiveMultiplier` = либо ручной из pref,
  // либо вычисленный авто. `data5m` — это финальные свечи, идущие в
  // ChartCanvas и Scanner.
  //
  // Важно: regroupCandles при mul=1 возвращает ТОТ ЖЕ массив (referential
  // equality), поэтому смена символа без переключения tick'а не приводит
  // к лишним аллокациям.
  // ============================================================================
  /**
   * Объединение исторических 5m с live-хвостом.
   *
   * Делегируем чистой функции `mergeRaw5mWithLive` — там же все edge-cases:
   *   • при `c.timestamp === lastHistoryTs` ЗАМЕНЯЕМ последнюю свечу
   *     (раньше тут было `>`, из-за чего цена «замирала», когда история
   *     заканчивалась тем же 5m-слотом, что и open-свеча live);
   *   • при `c.timestamp > lastHistoryTs` дописываем;
   *   • устаревший хвост из IDB (`<`) тихо игнорируется.
   *
   * Когда live выключен — возвращаем тот же массив (referential equality).
   */
  const rawData5mWithLive = useMemo<Candle5m[]>(() => {
    if (!liveActive) return rawData5m;
    return mergeRaw5mWithLive(rawData5m, liveClosedCandles, liveOpenCandle);
  }, [liveActive, rawData5m, liveClosedCandles, liveOpenCandle]);

  const autoMultiplier: TickMultiplier = useMemo(
    () => computeAutoMultiplier(rawData5mWithLive),
    [rawData5mWithLive],
  );
  const effectiveMultiplier: TickMultiplier =
    tickPref === 'auto' ? autoMultiplier : tickPref.manual;
  const data5m = useMemo(
    () => regroupCandles(rawData5mWithLive, effectiveMultiplier),
    [rawData5mWithLive, effectiveMultiplier],
  );

  const { htf: htfTf, ltf: ltfTf } = useMemo(() => chartTfsForPair(tfPairId), [tfPairId]);

  const data15mOhlc = useMemo(
    () => aggregateTo15m(rawData5mWithLive),
    [rawData5mWithLive],
  );
  const data1hOhlc = useMemo(
    () => aggregateTo1h(rawData5mWithLive),
    [rawData5mWithLive],
  );

  /**
   * LTF-данные для сканера и для экрана «вход».
   *
   * - 5m → нативные 5m с кластерами (regrouped).
   * - 15m → склейка 3×5m с merge кластеров.
   * - 1h  → склейка 12×5m с merge кластеров (нужно single-режиму '1h-1h',
   *         чтобы footprint работал на часе).
   */
  const ltfData = useMemo(() => {
    if (ltfTf === '5m') return data5m;
    if (ltfTf === '15m') return aggregate5mTo15mLtf(data5m);
    return aggregate5mTo1hLtf(data5m);
  }, [ltfTf, data5m]);

  /**
   * HTF-данные для разметки зон.
   *
   * В single-режиме HTF == LTF, и нам нужен общий массив с кластерами
   * (чтобы зоны и сканер работали по одной шкале), поэтому возвращаем `ltfData`.
   * В двухуровневом режиме HTF — это OHLCV без кластеров (1h или 15m).
   */
  const htfData = useMemo(() => {
    if (isSingleTf) return ltfData;
    return htfTf === '1h' ? data1hOhlc : data15mOhlc;
  }, [isSingleTf, ltfData, htfTf, data1hOhlc, data15mOhlc]);

  const chartTf: Timeframe = chartView === 'htf' ? htfTf : ltfTf;
  const chartData: readonly (Candle5m | Candle15m | Candle1h)[] =
    chartView === 'htf' ? htfData : ltfData;

  /**
   * Поведение HTF включается на экране HTF (двухуровневая пара) и в single-режиме.
   * Именно на этих экранах рисуется SMC-индикатор и доступна разметка POI.
   */
  const htfBehaviour = chartView === 'htf' || chartView === 'single';

  /**
   * SMC-overlay — пересчитывается при изменении HTF-данных или настроек.
   * На LTF в двухуровневой паре всегда возвращаем пустой overlay, чтобы
   * ChartCanvas просто ничего не рисовал.
   */
  const smcOverlay = useMemo(() => {
    const sourceData = isSingleTf ? chartData : htfData;
    if (sourceData.length === 0) return EMPTY_SMC_OVERLAY;
    return runSmcAnalysis(sourceData, smcLayers, smcOpts);
  }, [isSingleTf, chartData, htfData, smcLayers, smcOpts]);

  const handleToggleSmcLayer = useCallback((layer: keyof SmcLayers) => {
    setSmcLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, []);
  /**
   * Тоггл всей группы OB (базовый OB + BB + RB) одной кнопкой из тулбара.
   * Если хотя бы один из трёх включён → выключаем всё. Иначе включаем все.
   * Подсекции BB/RB остаются с независимым опт-ин через настройки —
   * это master-выключатель.
   */
  const handleToggleObGroup = useCallback(() => {
    setSmcLayers((prev) => {
      const anyOn = prev.orderBlocks || prev.breakerBlocks || prev.rejectionBlocks;
      const next = !anyOn;
      return {
        ...prev,
        orderBlocks: next,
        breakerBlocks: next,
        rejectionBlocks: next,
      };
    });
  }, []);
  const handleOpenSmcSettings = useCallback((x: number, y: number) => {
    setSmcSettingsAnchor({ x, y });
  }, []);
  const handleCloseSmcSettings = useCallback(() => {
    setSmcSettingsAnchor(null);
  }, []);
  const handleOpenHelp = useCallback(() => setHelpOpen(true), []);
  const handleCloseHelp = useCallback(() => setHelpOpen(false), []);

  const handleToggleBacktest = useCallback(() => {
    setBacktestOpen((prev) => !prev);
  }, []);
  const handleToggleOptimizer = useCallback(() => {
    setOptimizerOpen((prev) => !prev);
  }, []);
  const handleRunBacktest = useCallback(
    (settings: BacktestSettings) => {
      if (ltfData.length === 0) {
        window.alert('Сначала загрузите данные.');
        return;
      }
      const info = findSymbol(symbol);
      if (!info) return;
      setBacktestRunning(true);
      requestAnimationFrame(() => {
        const merged = { ...settings, fvgMaxFillPct: smcOpts.fvgMaxFillPct };
        const zones = collectZones(smcOverlay, merged.zoneGapPct);
        const report = runBacktest(ltfData as Candle5m[], smcOverlay, merged);
        setBacktestZones(zones);
        setBacktestReport(report);
        setBacktestRunning(false);
      });
    },
    [ltfData, smcOverlay, smcOpts.fvgMaxFillPct, symbol],
  );

  /**
   * Расширенный бэктест: загружает N свечей из Vision (с кластерами) и
   * прогоняет один backtest с текущими настройками. Три уровня кэша
   * (быстрый → медленный):
   *   1) extendedCacheRef — in-memory, текущая сессия.
   *   2) IndexedDB store `extendedDatasets` — pre-regrouped, один read.
   *   3) IndexedDB store `visionDays` + Vision-сеть — daily-cache + fetch.
   * Klines не используем — кластерные правила входа (`checkSignal`) дадут
   * 0 сделок без real-кластерных полей.
   */
  const handleRunExtended = useCallback(
    async (settings: BacktestSettings, candleCount: ExtendedCandleCount) => {
      const days = daysForCandles(candleCount);
      const cacheKey = `${symbol}-${days}-${effectiveMultiplier}`;
      extendedAbortRef.current?.abort();
      const ac = new AbortController();
      extendedAbortRef.current = ac;
      setExtendedRunning(true);
      setExtendedReport(null);
      setExtendedProgress({ stage: 'loading', loaded: 0, total: days });
      // Очищаем dev-log в начале прогона — каждый запуск = свой контекст
      // для диагностики.
      devLogClear();
      devLog('extended-bt:start', {
        candleCount,
        days,
        symbol,
        effectiveMultiplier,
        ltfTf,
        htfTf,
        isSingleTf,
        smcLayers,
      });

      let raw5m: readonly Candle5m[] | null = null;

      // Уровень 1: in-memory кэш сессии.
      const memCached = extendedCacheRef.current.get(cacheKey);
      if (memCached) {
        raw5m = memCached;
      }

      // Уровень 2: pre-regrouped датасет в IndexedDB — один read, мгновенно.
      if (raw5m === null) {
        setExtendedProgress({ stage: 'loading', loaded: 0, total: days, label: 'из кэша…' });
        const persisted = await loadExtendedDataset(symbol, days, effectiveMultiplier);
        if (ac.signal.aborted) {
          setExtendedProgress(null);
          setExtendedRunning(false);
          extendedAbortRef.current = null;
          return;
        }
        if (persisted && persisted.length > 0) {
          raw5m = persisted;
          extendedCacheRef.current.set(cacheKey, raw5m);
        }
      }

      // Уровень 3: качаем из Vision (с подневным кэшем под капотом).
      if (raw5m === null) {
        try {
          const dataset = await fetchVisionDataset({
            symbol,
            days,
            signal: ac.signal,
            onProgress: (info: ProgressInfo) => {
              setExtendedProgress({
                stage: 'loading',
                loaded: info.dayIndex,
                total: info.daysTotal,
                label: `${info.date} (${info.stage})`,
              });
            },
          });
          raw5m = regroupCandles(dataset.candles, effectiveMultiplier);
          extendedCacheRef.current.set(cacheKey, raw5m);
          // Сохраняем pre-regrouped датасет в IndexedDB — fire-and-forget.
          // Следующий запуск (даже после reload страницы) пойдёт через level 2.
          void saveExtendedDataset(symbol, days, effectiveMultiplier, raw5m);
        } catch (e) {
          if ((e as { name?: string }).name === 'AbortError') {
            setExtendedProgress(null);
            setExtendedRunning(false);
            extendedAbortRef.current = null;
            return;
          }
          setExtendedProgress(null);
          setExtendedRunning(false);
          extendedAbortRef.current = null;
          window.alert(`Не удалось загрузить расширенную историю: ${(e as Error).message}`);
          return;
        }
      }

      if (raw5m === null || ac.signal.aborted) {
        setExtendedProgress(null);
        setExtendedRunning(false);
        extendedAbortRef.current = null;
        return;
      }

      setExtendedProgress({ stage: 'computing' });
      // Берём ровно последние candleCount свечей: загружено может быть чуть больше,
      // т.к. days считается с округлением вверх.
      const trimmed = raw5m.length > candleCount ? raw5m.slice(-candleCount) : raw5m;

      // Применяем агрегацию под текущий ltfTf. Для HTF — тот же датасет,
      // агрегированный до htfTf; в single-режиме HTF == LTF.
      const ltf: readonly Candle5m[] = ltfTf === '5m'
        ? trimmed
        : ltfTf === '15m'
          ? aggregate5mTo15mLtf(trimmed)
          : aggregate5mTo1hLtf(trimmed);
      const smcCandles = isSingleTf
        ? ltf
        : (htfTf === '1h' ? aggregate5mTo1hLtf(trimmed) : aggregate5mTo15mLtf(trimmed));

      // Сдвигаем тяжёлое в next-frame, чтобы прогресс-бар успел обновиться
      // на "computing" перед блокировкой UI на overlay+backtest.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (ac.signal.aborted) {
        setExtendedProgress(null);
        setExtendedRunning(false);
        extendedAbortRef.current = null;
        return;
      }

      const merged = { ...settings, fvgMaxFillPct: smcOpts.fvgMaxFillPct, debugLog: false };
      const overlay = runSmcAnalysis(smcCandles, smcLayers, smcOpts);
      const report = runBacktest(ltf as Candle5m[], overlay, merged);

      // Диагностика → frontend/dev-log.txt, читается ассистентом напрямую.
      devLog('extended-bt:result', {
        candleCount,
        ltfTf,
        htfTf,
        isSingleTf,
        loaded_5m: raw5m.length,
        trimmed_5m: trimmed.length,
        ltf_len: ltf.length,
        smcCandles_len: smcCandles.length,
        first_ltf_ts: ltf[0]?.timestamp ? new Date(ltf[0].timestamp).toISOString() : null,
        last_ltf_ts: ltf[ltf.length - 1]?.timestamp ? new Date(ltf[ltf.length - 1]!.timestamp).toISOString() : null,
        ltf_has_clusters: ltf[0]?.clusters?.length ?? 0,
        ltf_has_delta: ltf[0]?.delta,
        ltf_vpoc: ltf[0]?.vpoc_price,
        smcCandles_first_ts: smcCandles[0]?.timestamp ? new Date(smcCandles[0].timestamp).toISOString() : null,
        smcLayers,
        overlay_counts: {
          fvgs: overlay.fvgs.length,
          orderBlocks: overlay.orderBlocks.length,
          breakerBlocks: overlay.breakerBlocks.length,
          rejectionBlocks: overlay.rejectionBlocks.length,
          liquidity: overlay.liquidity.length,
          structure: overlay.structure.length,
        },
        trades: report.totalTrades,
        merged_settings: merged,
      });

      setExtendedReport(report);
      setExtendedCandleCount(candleCount);
      setExtendedProgress(null);
      setExtendedRunning(false);
      extendedAbortRef.current = null;
    },
    [symbol, effectiveMultiplier, ltfTf, htfTf, isSingleTf, smcLayers, smcOpts],
  );

  const handleCancelExtended = useCallback(() => {
    extendedAbortRef.current?.abort();
  }, []);

  // ============================================================================
  // Live-режим: старт/стоп, авто-остановка при смене символа.
  //
  // ВАЖНО: manager не реактивен — это ref. State'ы liveClosedCandles /
  // liveOpenCandle обновляются через onSnapshot (RAF-throttled).
  // ============================================================================
  const stopLiveInternal = useCallback(async () => {
    const mgr = liveManagerRef.current;
    if (mgr) {
      try {
        await mgr.stop();
      } catch (e) {
        console.warn('[live] stop failed', e);
      }
      liveManagerRef.current = null;
    }
    liveSymbolRef.current = null;
    setLiveActive(false);
    setLiveStatus('idle');
    // closed/open сбрасываем — следующий запуск загрузит свой хвост из IDB.
    setLiveClosedCandles([]);
    setLiveOpenCandle(null);
    setLiveStats(null);
  }, []);

  const handleToggleLive = useCallback(async () => {
    if (liveActive) {
      await stopLiveInternal();
      return;
    }
    const info = findSymbol(symbol);
    if (!info) return;

    setLiveActive(true);
    setLiveStatus('connecting');
    setStatus({
      kind: 'loading',
      loaded: 0,
      total: 1,
      label: `Live: догоняем последние 24ч ${info.short}/USDT…`,
    });

    // ========================================================================
    // 1. Pre-load свежей истории за последние 24 часа (REST klines).
    //
    // Зачем: prebuilt-датасет может быть «вчерашним», и без догона
    // пользователь увидит огромный gap справа и одну живую свечу.
    // Делаем максимально надёжно:
    //   • основной путь — лёгкий /api/v3/klines limit=288;
    //   • если он вернул 0 свечей или упал → fallback на полнокровный
    //     fetchBinanceKlines days=1 (тот же эндпоинт, но через
    //     существующий loader с retry'ями и Zod-валидацией);
    //   • если оба упали → стартуем WS «как есть», предупреждение
    //     пользователю в StatusBar.
    // ========================================================================
    let prefetched: Candle5m[] = [];
    let prefetchErr: string | null = null;
    try {
      prefetched = await fetchRecentKlines5m({ symbol, limit: 288 });
    } catch (e) {
      prefetchErr = (e as Error).message ?? String(e);
      console.warn('[live] recent klines failed, will try fallback:', e);
    }

    if (prefetched.length === 0) {
      // Fallback: тяжёлый loader с retry'ями и валидацией.
      try {
        const ds = await fetchBinanceKlines({ symbol, days: 1 });
        prefetched = ds.candles;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        console.warn('[live] fallback klines also failed:', e);
        prefetchErr = prefetchErr ? `${prefetchErr}; fallback: ${msg}` : msg;
      }
    }

    if (prefetched.length > 0) {
      // Сливаем klines поверх текущей истории. Используем
      // mergeRaw5mWithKlines (НЕ mergeRaw5mWithLive!) — последняя
      // фильтрует свечи без кластеров, а у klines кластеров нет.
      // На совпадающих timestamp побеждает history (у неё есть
      // кластеры prebuilt-датасета).
      setRawData5m((prev) => mergeRaw5mWithKlines(prev, prefetched));

      // Диагностика: timestamps первой и последней свечи + «свежесть»
      // последней. Если ageMinutes > 30 — Binance отдал устаревшие
      // данные (часы / регион / API), переключаем плашку в красный.
      const firstTs = prefetched[0]!.timestamp;
      const lastTs = prefetched[prefetched.length - 1]!.timestamp;
      const ageMinutes = Math.round((Date.now() - lastTs) / 60_000);
      const fmt = (ts: number) =>
        new Date(ts).toLocaleTimeString('ru-RU', { hour12: false });
      const stale = ageMinutes > 30;

      console.info('[live] prefetched klines', {
        symbol,
        count: prefetched.length,
        firstTs: new Date(firstTs).toISOString(),
        lastTs: new Date(lastTs).toISOString(),
        ageMinutes,
        nowLocal: new Date().toISOString(),
      });

      setStatus({
        kind: stale ? 'error' : 'success',
        source: 'klines',
        message: stale
          ? `Live: Binance отдал устаревшие свечи! ${prefetched.length} шт., последняя — ${fmt(lastTs)} (${ageMinutes} мин назад). Проверь системные часы и регион.`
          : `Live: догнали ${prefetched.length} × 5m: ${fmt(firstTs)} → ${fmt(lastTs)} (${ageMinutes} мин назад). На prefetched-свечах footprint пустой (REST не отдаёт) — кластеры появятся на свечах, закрывающихся уже в Live (≈ раз в 5 мин).`,
      });
      // КРИТИЧНО: между prebuilt-датасетом (например 7 дней назад) и
      // 24ч-prefetched большой gap по времени. resetView() растянет
      // viewport на весь min..max → 24ч-хвост сожмётся в полоску.
      // Поэтому делаем zoom строго на последние 24ч + 5мин буфера.
      //
      // Auto-fit в useChartViewport теперь не дёргается при добавлении
      // свечей справа (см. фикс ключа useChartViewport.ts), поэтому
      // достаточно одного RAF — дождаться, чтобы React применил
      // setRawData5m и chart перерисовался с новыми candles.
      const focusStart = prefetched[0]!.timestamp;
      const focusEnd = Date.now() + 5 * 60 * 1000;
      requestAnimationFrame(() => {
        viewportApiRef.current?.zoomToTimeRange(focusStart, focusEnd);
      });
    } else {
      setStatus({
        kind: 'error',
        message: `Live: не удалось догнать историю${prefetchErr ? ` (${prefetchErr})` : ''}. WebSocket стартует, свечи будут появляться с текущего момента.`,
      });
    }

    // ========================================================================
    // 2. Создаём менеджер и подключаем WebSocket.
    // ========================================================================
    const mgr = createLiveCandleManager({
      symbol,
      tickSize: info.tickSize,
      onStatus: (st) => setLiveStatus(st),
      onSnapshot: (snap) => {
        setLiveClosedCandles(snap.closedCandles);
        setLiveOpenCandle(snap.openCandle);
      },
      onCandleClosed: () => {
        // Триггер пересчёта SMC + сканера произойдёт автоматически через
        // useMemo по rawData5mWithLive (см. ниже).
      },
      onError: (e) => console.warn('[live]', e),
    });
    liveManagerRef.current = mgr;
    liveSymbolRef.current = symbol;
    try {
      await mgr.start();
    } catch (e) {
      console.warn('[live] start failed', e);
      setStatus({
        kind: 'error',
        message: `Live: не удалось подключить WebSocket (${(e as Error).message ?? 'unknown'}).`,
      });
      await stopLiveInternal();
    }
  }, [liveActive, symbol, stopLiveInternal]);

  // Авто-остановка при смене символа: гонять live по старому символу нельзя.
  useEffect(() => {
    if (liveSymbolRef.current && liveSymbolRef.current !== symbol) {
      void stopLiveInternal();
    }
  }, [symbol, stopLiveInternal]);

  // Корректное завершение при размонтировании (например, hot-reload).
  useEffect(() => {
    return () => {
      void liveManagerRef.current?.stop();
    };
  }, []);

  // Polling диагностики: пока live активен — раз в секунду подтягиваем
  // счётчики из менеджера (ticks, snapshots, lastTickAt). Header сам решит,
  // как их визуализировать пользователю.
  useEffect(() => {
    if (!liveActive) {
      // Чистим устаревшую статистику при выключении live — это синхронизация
      // с внешним переключателем, корректный setState в useEffect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveStats(null);
      return;
    }
    const id = setInterval(() => {
      const mgr = liveManagerRef.current;
      if (mgr) setLiveStats(mgr.getDebugStats());
    }, 1000);
    return () => clearInterval(id);
  }, [liveActive]);

  const ltfPadMs = LTF_CONTEXT_CANDLES * candleDurationMs(ltfTf);
  const signalFocusPadMs = SIGNAL_FOCUS_HALF_CANDLES * candleDurationMs(ltfTf);

  // ============================================================================
  // Загрузка истории с Binance
  // ============================================================================
  const handleLoadHistory = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setStatus({ kind: 'loading', loaded: 0, total: 7, label: 'Запрос Binance Vision…' });

    // 1) Пробуем Vision (настоящие aggTrades с кластерами)
    try {
      const dataset = await fetchVisionDataset({
        symbol,
        days: 7,
        signal: ac.signal,
        onProgress: (info) => {
          setStatus({
            kind: 'loading',
            loaded: info.dayIndex,
            total: info.daysTotal,
            label: visionStageLabel(info),
          });
        },
      });

      const ltf = dataset.candles;
      setRawData5m(ltf);
      setStatus({
        kind: 'success',
        source: 'vision',
        message: `Vision aggTrades: ${ltf.length} × 5m с настоящими кластерами (${dataset.meta.from.slice(0, 10)} … ${dataset.meta.to.slice(0, 10)})`,
      });
      return;
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;
      console.warn('[Vision] failed, falling back to klines:', e);
    }

    // 2) Fallback на REST klines (без кластеров)
    setStatus({ kind: 'loading', loaded: 0, total: 1440, label: 'Vision недоступен, грузим klines…' });
    try {
      const dataset = await fetchBinanceKlines({
        symbol,
        days: 7,
        signal: ac.signal,
        onProgress: (loaded, total) => {
          setStatus({ kind: 'loading', loaded, total, label: 'Binance klines (без кластеров)' });
        },
      });

      const ltf = dataset.candles;
      setRawData5m(ltf);
      setStatus({
        kind: 'success',
        source: 'klines',
        message: `Binance klines (без кластеров): ${ltf.length} × 5m. Footprint доступен на моке.`,
      });
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return;

      const mock = generateMockData();
      setRawData5m(mock.candles);
      setStatus({
        kind: 'error',
        message: `Все источники Binance недоступны (${(e as Error).message ?? 'unknown'}). Показаны моковые данные.`,
      });
    }
  };

  const handleLoadMock = useCallback(() => {
    abortRef.current?.abort();
    const mock = generateMockData();
    setRawData5m(mock.candles);
    setStatus({
      kind: 'success',
      source: 'mock',
      message: `Демо-данные: ${mock.candles.length} × 5m с моделированными кластерами и идеальными сетапами LONG/SHORT.`,
    });
  }, []);

  /**
   * Загрузка датасета из локального JSON-файла (drag&drop или «Открыть JSON»).
   *
   * Источник правды: smc-data pipeline. Файл проходит строгую Zod-валидацию
   * (см. datasetSchema.ts), так что любое расхождение со схемой — отклоняем
   * с понятной ошибкой.
   */
  const handleLoadFile = useCallback(async (file: File) => {
    abortRef.current?.abort();
    setStatus({
      kind: 'loading',
      loaded: 0,
      total: 1,
      label: `Парсим ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`,
    });
    const result = await loadDatasetFromFile(file);
    if (!result.ok) {
      setStatus({
        kind: 'error',
        message: `Не удалось загрузить ${file.name}: ${result.error}`,
      });
      return;
    }
    const ltf = result.data.candles;
    setRawData5m(ltf);
    setStatus({
      kind: 'success',
      source: 'file',
      message: `Файл ${file.name}: ${ltf.length} × 5m с реальными кластерами (${result.data.meta.from.slice(0, 10)} … ${result.data.meta.to.slice(0, 10)})`,
    });
  }, []);

  /**
   * Глобальный drag & drop: при дропе .json в любое место окна — грузим как датасет.
   * Disabled пока идёт другая загрузка, чтобы не получать race condition по статусам.
   */
  const { isDragging } = useDropZone({
    onFile: handleLoadFile,
    onReject: (reason) => setStatus({ kind: 'error', message: reason }),
    disabled: status.kind === 'loading',
  });

  // ============================================================================
  // Создание / удаление / навигация по POI
  // ============================================================================
  const handleCreateZone = useCallback(
    (coords: DraftZoneCoords) => {
      const startTime = Math.min(coords.startTime, coords.endTime);
      const endTime = Math.max(coords.startTime, coords.endTime);
      const minPrice = Math.min(coords.startPrice, coords.endPrice);
      const maxPrice = Math.max(coords.startPrice, coords.endPrice);

      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const newZone: POIZone = {
        id,
        startTime,
        endTime,
        minPrice,
        maxPrice,
        hasSignal: false,
      };

      // Применяем напрямую, потом записываем reversible-action.
      setZones((prev) => [...prev, newZone]);
      setSelectedZoneId(id);

      undoStack.push({
        payload: { kind: 'create', zone: newZone },
        apply: () => setZones((prev) => (prev.some((z) => z.id === id) ? prev : [...prev, newZone])),
        revert: () => {
          setZones((prev) => prev.filter((z) => z.id !== id));
          // если эта зона была выбрана — снимаем выбор тоже
          setSelectedZoneId((cur) => (cur === id ? null : cur));
        },
      });
    },
    [undoStack],
  );

  const handleDeleteZone = useCallback(
    (zoneId: string) => {
      // Сохраняем snapshot ДО удаления, чтобы можно было восстановить.
      const victim = zones.find((z) => z.id === zoneId);
      if (!victim) return;

      setZones((prev) => prev.filter((z) => z.id !== zoneId));
      if (selectedZoneId === zoneId) setSelectedZoneId(null);
      setZoneMenu(null);

      undoStack.push({
        payload: { kind: 'delete', zone: victim },
        apply: () => {
          setZones((prev) => prev.filter((z) => z.id !== zoneId));
          setSelectedZoneId((cur) => (cur === zoneId ? null : cur));
        },
        revert: () => {
          // Возвращаем удалённую зону. Если её id уже встречается (нечто странное —
          // может, кто-то создал новую с тем же id), не дублируем.
          setZones((prev) => (prev.some((z) => z.id === victim.id) ? prev : [...prev, victim]));
        },
      });
    },
    [zones, selectedZoneId, undoStack],
  );

  const handleZoneClick = useCallback(
    (zone: POIZone, screenX: number, screenY: number) => {
      setSelectedZoneId(zone.id);
      setZoneMenu({ zoneId: zone.id, x: screenX, y: screenY });
    },
    [],
  );

  const handleClickEmpty = useCallback(() => {
    setSelectedZoneId(null);
    setZoneMenu(null);
    setSelectedSignalId(null);
  }, []);

  const handleJumpToLTF = useCallback(
    (zone: POIZone) => {
      // В single-режиме «переходить» некуда — мы и так на нужном ТФ,
      // просто зумим viewport на зоне. В двухуровневом — переключаем экран.
      if (!isSingleTf) setChartView('ltf');
      setTool('pointer');
      setZoneMenu(null);
      requestAnimationFrame(() => {
        viewportApiRef.current?.zoomToTimeRange(
          zone.startTime - ltfPadMs,
          zone.endTime + ltfPadMs,
        );
      });
    },
    [isSingleTf, ltfPadMs],
  );

  const handleBackToHTF = useCallback(() => {
    setChartView('htf');
    setTool('pointer');
    setZoneMenu(null);
    setSelectedSignalId(null);
    requestAnimationFrame(() => {
      viewportApiRef.current?.resetView();
    });
  }, []);

  // Сортированный список сигналов — стабильный порядок для prev/next.
  const sortedSignals = useMemo(
    () => [...signals].sort((a, b) => a.candleTime - b.candleTime),
    [signals],
  );

  /**
   * Выбор сигнала. На экране HTF переключаем на LTF и центрируем viewport на свече.
   * В single-режиме маркеры и так видны — просто запоминаем выбор без зума,
   * чтобы не «прыгать» между соседними кликами по соседним сигналам.
   */
  const handleSelectSignal = useCallback(
    (signalId: string) => {
      const sig = sortedSignals.find((s) => s.id === signalId);
      if (!sig) return;
      setSelectedSignalId(signalId);
      setZoneMenu(null);
      setSelectedZoneId(null);

      if (chartView === 'htf') {
        setChartView('ltf');
        setTool('pointer');
        requestAnimationFrame(() => {
          viewportApiRef.current?.zoomToTimeRange(
            sig.candleTime - signalFocusPadMs,
            sig.candleTime + signalFocusPadMs,
          );
        });
      }
    },
    [sortedSignals, chartView, signalFocusPadMs],
  );

  /** Перейти к соседнему сигналу. dir = -1 (назад) или +1 (вперёд). */
  const handleNavigateSignal = useCallback(
    (dir: -1 | 1) => {
      if (sortedSignals.length === 0) return;
      const currentIdx = selectedSignalId
        ? sortedSignals.findIndex((s) => s.id === selectedSignalId)
        : -1;
      // Если ничего не выбрано — стартуем с первого (вперёд) или последнего (назад).
      const nextIdx =
        currentIdx === -1
          ? dir === 1
            ? 0
            : sortedSignals.length - 1
          : (currentIdx + dir + sortedSignals.length) % sortedSignals.length;
      const nextSig = sortedSignals[nextIdx];
      if (!nextSig) return;
      setSelectedSignalId(nextSig.id);
      // В single-режиме мы уже на нужном экране; в двухуровневом — гарантируем LTF.
      if (!isSingleTf && chartView !== 'ltf') {
        setChartView('ltf');
        setTool('pointer');
      }
      requestAnimationFrame(() => {
        viewportApiRef.current?.zoomToTimeRange(
          nextSig.candleTime - signalFocusPadMs,
          nextSig.candleTime + signalFocusPadMs,
        );
      });
    },
    [sortedSignals, selectedSignalId, chartView, isSingleTf, signalFocusPadMs],
  );

  const handleClearAll = useCallback(() => {
    if (zones.length === 0) return;
    if (!window.confirm(`Удалить все зоны (${zones.length})?`)) return;

    // Снимаем snapshot, чтобы можно было откатить.
    const zonesSnapshot = zones;
    const signalsSnapshot = signals;

    setZones([]);
    setSelectedZoneId(null);
    setZoneMenu(null);
    setSignals([]);
    setSelectedSignalId(null);
    setScanner(null);

    undoStack.push({
      payload: { kind: 'clear', zones: zonesSnapshot, signals: signalsSnapshot },
      apply: () => {
        setZones([]);
        setSelectedZoneId(null);
        setZoneMenu(null);
        setSignals([]);
        setSelectedSignalId(null);
        setScanner(null);
      },
      revert: () => {
        setZones(zonesSnapshot);
        setSignals(signalsSnapshot);
        // scanner-отчёт не восстанавливаем — он эфемерный.
      },
    });
  }, [zones, signals, undoStack]);

  // ============================================================================
  // Сканер сигналов (Web Worker + fallback на main thread)
  // ============================================================================
  const handleRunScanner = useCallback(() => {
    console.log('[scanner] handleRunScanner called', {
      candles: ltfData.length,
      zones: zones.length,
    });

    if (ltfData.length === 0) {
      console.warn('[scanner] нет данных, выхожу');
      window.alert('Сначала загрузите данные (кнопки «Демо» или «Загрузить историю»).');
      return;
    }

    // Если зон нет — explore-режим: сканируем весь датасет одной виртуальной зоной.
    // Так пользователь видит, ГДЕ в данных есть сигналы, и может потом
    // нарисовать настоящие POI вокруг них.
    const isExploreMode = zones.length === 0;
    // Используем Number.MAX_SAFE_INTEGER, а не Infinity — Infinity у некоторых
    // движков может портиться при postMessage / structured clone.
    const zonesToScan: POIZone[] = isExploreMode
      ? [
          {
            id: '__explore__',
            startTime: 0,
            endTime: Number.MAX_SAFE_INTEGER,
            minPrice: 0,
            maxPrice: Number.MAX_SAFE_INTEGER,
            hasSignal: false,
          },
        ]
      : zones;

    console.log('[scanner] mode:', isExploreMode ? 'EXPLORE (без зон)' : `по ${zones.length} зонам`);
    scannerRunningRef.current = true;
    setScannerRunning(true);

    // Гард, чтобы ровно один из путей (worker / fallback) применил результат.
    let applied = false;
    const applyResult = (
      newSignals: Signal[],
      zoneIdsWithSignal: string[],
      report: ScannerReportData,
      elapsedMs: number,
    ) => {
      if (applied) return;
      applied = true;
      console.log('[scanner] applyResult:', {
        signals: newSignals.length,
        report,
        elapsedMs: elapsedMs.toFixed(1) + 'ms',
      });
      scannerRunningRef.current = false;
      setScannerRunning(false);
      setSignals(newSignals);
      // Старый выбранный ID мог пропасть после нового прогона — снимаем явно.
      setSelectedSignalId(null);

      // В explore-режиме виртуальная зона не считается размеченной — корректируем report.
      const adjustedReport: ScannerReportData = isExploreMode
        ? { ...report, zonesTotal: 0, zonesWithSignal: 0 }
        : report;
      setScanner({ report: adjustedReport, elapsedMs, isExploreMode });

      // В explore-режиме никакие реальные зоны не помечаются.
      if (!isExploreMode) {
        setZones((prev) =>
          prev.map((z) => {
            const has = zoneIdsWithSignal.includes(z.id);
            if (z.hasSignal === has) return z;
            return { ...z, hasSignal: has };
          }),
        );
      }
    };

    // Создаём воркер один раз и переиспользуем.
    // Vite требует относительный путь в `new URL(..., import.meta.url)` —
    // alias `@/` тут НЕ работает (Vite делает статический анализ AST для code split).
    if (!scannerWorkerRef.current) {
      try {
        scannerWorkerRef.current = new Worker(
          new URL('./scanner/scannerWorker.ts', import.meta.url),
          { type: 'module' },
        );
        scannerWorkerRef.current.onerror = (err) => {
          console.error('[scanner-worker] onerror:', err);
        };
        console.log('[scanner] worker создан');
      } catch (e) {
        console.warn('[scanner] Worker creation failed, falling back to main thread:', e);
        scannerWorkerRef.current = null;
      }
    }

    if (scannerWorkerRef.current) {
      const worker = scannerWorkerRef.current;
      const onMessage = (e: MessageEvent<ScannerWorkerResponse>) => {
        worker.removeEventListener('message', onMessage);
        console.log('[scanner] worker ответил:', e.data.kind);
        if (e.data.kind === 'error') {
          setScannerRunning(false);
          window.alert(`Ошибка сканера: ${e.data.message}`);
          return;
        }
        applyResult(e.data.signals, e.data.zoneIdsWithSignal, e.data.report, e.data.elapsedMs);
      };
      worker.addEventListener('message', onMessage);
      const request: ScannerWorkerRequest = { candles: ltfData, zones: zonesToScan };
      worker.postMessage(request);
      console.log('[scanner] postMessage отправлен в worker');

      // Safety net: если воркер не ответил за 5 сек — fallback на main thread.
      // Читаем актуальное состояние через ref (не stale-closure!) и проверяем
      // applied — иначе fallback задвоит результат, если воркер ответил почти одновременно.
      window.setTimeout(() => {
        if (!scannerRunningRef.current || applied) return;
        console.warn('[scanner] worker не ответил за 5s, делаю синхронный прогон');
        worker.removeEventListener('message', onMessage);
        const t0 = performance.now();
        const r = runScannerSync({ candles: ltfData, zones: zonesToScan });
        applyResult(r.signals, [...r.zoneIdsWithSignal], r.report, performance.now() - t0);
      }, 5000);
      return;
    }

    // Fallback: синхронный прогон (worker недоступен).
    console.log('[scanner] синхронный прогон (нет воркера)');
    const t0 = performance.now();
    const r = runScannerSync({ candles: ltfData, zones: zonesToScan });
    applyResult(r.signals, [...r.zoneIdsWithSignal], r.report, performance.now() - t0);
  }, [ltfData, zones]);

  // Терминируем воркер при размонтировании App.
  useEffect(() => {
    return () => {
      scannerWorkerRef.current?.terminate();
      scannerWorkerRef.current = null;
    };
  }, []);

  // ============================================================================
  // Hotkeys
  // ============================================================================
  const hotkeys = useMemo(
    () => ({
      v: () => setTool('pointer'),
      r: () => {
        // Рисование зон — на экране HTF и в single-режиме (там нет отдельного HTF).
        if (chartView === 'htf' || chartView === 'single') setTool('rectangle');
      },
      m: () => setTool('measure'),
      s: () => handleRunScanner(),
      escape: () => {
        setTool('pointer');
        setSelectedZoneId(null);
        setZoneMenu(null);
        setSelectedSignalId(null);
      },
      delete: () => {
        if (selectedZoneId) handleDeleteZone(selectedZoneId);
      },
      backspace: () => {
        if (selectedZoneId) handleDeleteZone(selectedZoneId);
      },
      arrowleft: () => {
        if (sortedSignals.length > 0) handleNavigateSignal(-1);
      },
      arrowright: () => {
        if (sortedSignals.length > 0) handleNavigateSignal(1);
      },
      // Undo/Redo. `mod` = Ctrl на Win/Linux и Cmd на macOS.
      'mod+z': () => {
        undoStack.undo();
      },
      'mod+shift+z': () => {
        undoStack.redo();
      },
      // Многие пользователи привычны к Ctrl+Y для redo (Win-конвенция).
      'mod+y': () => {
        undoStack.redo();
      },
    }),
    [
      chartView,
      selectedZoneId,
      sortedSignals.length,
      handleDeleteZone,
      handleRunScanner,
      handleNavigateSignal,
      undoStack,
    ],
  );
  useHotkeys(hotkeys);

  const goToHtfView = useCallback(() => {
    setChartView('htf');
    setTool('pointer');
    setZoneMenu(null);
    setSelectedSignalId(null);
    requestAnimationFrame(() => viewportApiRef.current?.resetView());
  }, []);

  const goToLtfView = useCallback(() => {
    setChartView('ltf');
    setTool('pointer');
    setZoneMenu(null);
    requestAnimationFrame(() => viewportApiRef.current?.resetView());
  }, []);

  // ============================================================================
  // Production state
  // ============================================================================
  const candlesCount = chartData.length;
  const isLoading = status.kind === 'loading';

  const activeZone = useMemo(
    () => (zoneMenu ? zones.find((z) => z.id === zoneMenu.zoneId) : null),
    [zoneMenu, zones],
  );

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-tv-bg text-tv-text">
      <Header
        symbol={symbol}
        onSymbolChange={setSymbol}
        chartTf={chartTf}
        chartView={chartView}
        isLoading={isLoading}
        onLoadHistory={handleLoadHistory}
        onLoadMock={handleLoadMock}
        onLoadFile={handleLoadFile}
        onBackToHTF={handleBackToHTF}
        liveStatus={liveStatus}
        liveActive={liveActive}
        liveStats={liveStats}
        onToggleLive={handleToggleLive}
        backtestOpen={backtestOpen}
        optimizerOpen={optimizerOpen}
        onToggleOptimizer={handleToggleOptimizer}
        onToggleBacktest={handleToggleBacktest}
      />

      {/* Полноэкранный оверлей при drag&drop файла. */}
      <DropOverlay visible={isDragging} />

      <main className="relative flex-1 overflow-hidden">
        <Toolbox
          tool={tool}
          zoneDrawingEnabled={htfBehaviour}
          zonesCount={zones.length}
          hasData={ltfData.length > 0}
          scannerRunning={scannerRunning}
          canUndo={canUndo}
          canRedo={canRedo}
          smcLayers={htfBehaviour ? smcLayers : null}
          onToggleSmcLayer={handleToggleSmcLayer}
          onToggleObGroup={handleToggleObGroup}
          onOpenSmcSettings={handleOpenSmcSettings}
          onOpenHelp={handleOpenHelp}
          onSelectTool={setTool}
          onRunScanner={handleRunScanner}
          onClearAll={handleClearAll}
          onUndo={undoStack.undo}
          onRedo={undoStack.redo}
        />

        <ChartCanvas
          data={chartData}
          chartTf={chartTf}
          chartRole={chartView}
          ltfChartTf={ltfTf}
          tool={tool}
          zones={zones}
          selectedZoneId={selectedZoneId}
          signals={signals}
          selectedSignalId={selectedSignalId}
          smcOverlay={htfBehaviour ? smcOverlay : EMPTY_SMC_OVERLAY}
          liqUseBslSslLabels={smcOpts.liqUseBslSslLabels}
          onCreateZone={handleCreateZone}
          onZoneClick={handleZoneClick}
          onClickEmpty={handleClickEmpty}
          onSelectSignal={handleSelectSignal}
          onHoverCandle={handleHoverCandle}
          onHoverCluster={handleHoverCluster}
          onViewportApi={handleViewportApi}
          backtestTrades={backtestReport?.trades ?? []}
          backtestZones={backtestZones}
        />

        {/* Popover настроек SMC (открывается из Toolbox по шестерёнке) */}
        {smcSettingsAnchor && (
          <SmcSettingsPopover
            options={smcOpts}
            onChange={setSmcOpts}
            layers={smcLayers}
            onLayersChange={setSmcLayers}
            onClose={handleCloseSmcSettings}
            onOpenHelp={handleOpenHelp}
            anchorX={smcSettingsAnchor.x}
            anchorY={smcSettingsAnchor.y}
          />
        )}

        {/* Панель бэктеста */}
        {backtestOpen && (
          <BacktestPanel
            settings={backtestSettings}
            onSettingsChange={setBacktestSettings}
            onRun={handleRunBacktest}
            report={backtestReport}
            running={backtestRunning}
            onRunExtended={handleRunExtended}
            extendedReport={extendedReport}
            extendedRunning={extendedRunning}
            extendedProgress={extendedProgress}
            extendedCandleCount={extendedCandleCount}
            onCancelExtended={handleCancelExtended}
          />
        )}

        {/* Окно оптимизатора */}
        {optimizerOpen && (
          <OptimizerPanel
            baseSettings={{ ...backtestSettings, fvgMaxFillPct: smcOpts.fvgMaxFillPct }}
            baseSmcOpts={smcOpts}
            smcLayers={smcLayers}
            prepareData={(mult) => {
              // mult приходит как `number | undefined` (контракт оптимизатора),
              // но реальные значения всегда из набора TickMultiplier (1/2/5/10) —
              // их перебирает грид оптимизатора. Кастуем для совместимости с
              // regroupCandles, который требует литеральный тип.
              const m: TickMultiplier = (mult ?? effectiveMultiplier) as TickMultiplier;
              const d5m = regroupCandles(rawData5mWithLive, m);
              const ltf = ltfTf === '5m'
                ? d5m
                : ltfTf === '15m'
                  ? aggregate5mTo15mLtf(d5m)
                  : aggregate5mTo1hLtf(d5m);
              // В single-режиме HTF == LTF (с кластерами). В мультирежиме
              // HTF не зависит от multiplier (OHLCV без кластеров).
              const smcCandles = isSingleTf
                ? ltf
                : (htfTf === '1h' ? data1hOhlc : data15mOhlc);
              return { candles: ltf as Candle5m[], smcCandles };
            }}
            onClose={handleToggleOptimizer}
            onApply={(next) => {
              setBacktestSettings(next);
              setOptimizerOpen(false);
              setBacktestOpen(true);
            }}
            onApplySmc={(next) => {
              setSmcOpts(next);
            }}
            onApplyMultiplier={(mult) => {
              if (mult === undefined) return;
              setTickPref({ manual: mult });
            }}
            symbol={symbol}
            tfPairId={tfPairId}
          />
        )}

        {/* Полное руководство пользователя — большая модалка с TOC */}
        {helpOpen && <HelpModal onClose={handleCloseHelp} />}

        {/* Контекстное меню зоны */}
        {zoneMenu && activeZone && (
          <ZoneMenu
            zone={activeZone}
            anchorX={zoneMenu.x}
            anchorY={zoneMenu.y}
            onJumpToLTF={handleJumpToLTF}
            onDelete={handleDeleteZone}
            onClose={() => setZoneMenu(null)}
          />
        )}

        {/* Переключатель таймфрейма + размер ячейки footprint */}
        {data5m.length > 0 && (
          <div className="absolute right-20 top-2 z-10 flex items-center gap-2">
            {/* TickPicker имеет смысл, когда на экране есть кластеры:
                это LTF в двухуровневом режиме и любой single-режим. */}
            {(chartView === 'ltf' || chartView === 'single') && (
              <TickPicker
                pref={tickPref}
                effective={effectiveMultiplier}
                onChange={setTickPref}
              />
            )}
            <TfPairSelector
              value={tfPairId}
              onChange={(id) => {
                setTfPairId(id);
                saveTfPairId(id);
              }}
              disabled={isLoading}
            />
            {/* Переключатель HTF/LTF нужен только в двухуровневом режиме. */}
            {!isSingleTf && (
              <div className="flex gap-1 rounded border border-tv-border bg-tv-panel/95 p-1 shadow-lg">
                <TfButton active={chartView === 'htf'} onClick={goToHtfView}>
                  HTF
                </TfButton>
                <TfButton active={chartView === 'ltf'} onClick={goToLtfView}>
                  LTF
                </TfButton>
              </div>
            )}
          </div>
        )}

        {/* Подсказка-режим: рисование */}
        {tool === 'rectangle' && (chartView === 'htf' || chartView === 'single') && (
          <div className="pointer-events-none absolute top-4 left-1/2 z-30 -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 backdrop-blur-sm">
            Режим разметки · нажмите и растяните, Esc — отмена
          </div>
        )}

        {/* Прогресс сканера */}
        {scannerRunning && (
          <div className="absolute bottom-3 right-3 z-30 flex items-center gap-2 rounded-md border border-tv-border bg-tv-panel/95 px-3 py-2 text-xs text-tv-text shadow-2xl backdrop-blur-sm">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-tv-accent border-t-transparent" />
            Сканер работает в фоне…
          </div>
        )}

        {/* Отчёт сканера */}
        {!scannerRunning && scanner && (
          <ScannerReport
            report={scanner.report}
            elapsedMs={scanner.elapsedMs}
            isExploreMode={scanner.isExploreMode}
            onClose={() => setScanner(null)}
          />
        )}

        {/* Детальная карточка выбранного сигнала (внизу-слева) */}
        {(() => {
          if (!selectedSignalId) return null;
          const idx = sortedSignals.findIndex((s) => s.id === selectedSignalId);
          if (idx === -1) return null;
          const sig = sortedSignals[idx];
          if (!sig) return null;
          return (
            <TradeDetailPanel
              signal={sig}
              index={idx + 1}
              total={sortedSignals.length}
              onClose={() => setSelectedSignalId(null)}
              onPrev={() => handleNavigateSignal(-1)}
              onNext={() => handleNavigateSignal(1)}
            />
          );
        })()}

        {/* Тултип по кластеру (footprint-режим). Позиционируется по clientX/Y,
            поэтому рендерится последним поверх всего, кроме модальных окон. */}
        {hoveredClusterInfo && (
          <ClusterTooltip
            cluster={hoveredClusterInfo.hitbox.cluster}
            candleTimestamp={hoveredClusterInfo.hitbox.candleTimestamp}
            clientX={hoveredClusterInfo.clientX}
            clientY={hoveredClusterInfo.clientY}
          />
        )}

        {/* Статус-баннер: прогресс / ошибка / источник */}
        <StatusBanner status={status} />
      </main>

      <StatusBar
        symbol={symbol}
        timeframe={chartTf}
        candlesCount={candlesCount}
        zonesCount={zones.length}
        signalsCount={signals.length}
        hoveredCandle={hoveredCandle}
      />
    </div>
  );
}

interface StatusBannerProps {
  status: LoadStatus;
}

function StatusBanner({ status }: StatusBannerProps) {
  if (status.kind === 'idle') return null;

  if (status.kind === 'loading') {
    const pct =
      status.total > 0 ? Math.min(100, Math.round((status.loaded / status.total) * 100)) : 0;
    return (
      <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-md border border-tv-border bg-tv-panel/95 px-4 py-2 text-xs text-tv-text shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-tv-accent border-t-transparent" />
          <span>{status.label}</span>
          <span className="font-mono text-tv-text-dim">
            {status.loaded} / {status.total} ({pct}%)
          </span>
        </div>
      </div>
    );
  }

  if (status.kind === 'success') {
    return (
      <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 animate-fadeOut rounded-md border border-tv-up/40 bg-tv-up/10 px-4 py-2 text-xs text-tv-up shadow-2xl backdrop-blur-sm">
        ✓ {status.message}
      </div>
    );
  }

  return (
    <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 max-w-[90%] rounded-md border border-tv-down/40 bg-tv-down/10 px-4 py-2 text-xs text-tv-down shadow-2xl backdrop-blur-sm">
      ⚠ {status.message}
    </div>
  );
}

interface TfButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function visionStageLabel(info: ProgressInfo): string {
  const head = `Vision · день ${info.dayIndex} из ${info.daysTotal} (${info.date})`;
  switch (info.stage) {
    case 'cache':
      return `${head} · проверяем кэш`;
    case 'download': {
      const mb = info.bytes ? (info.bytes / (1024 * 1024)).toFixed(1) : '0';
      return `${head} · скачано ${mb} MB`;
    }
    case 'unzip':
      return `${head} · распаковка`;
    case 'parse': {
      const k = info.ticks ? (info.ticks / 1000).toFixed(0) : '0';
      return `${head} · парсинг ${k}k тиков`;
    }
    case 'done':
      return `${head} · готово`;
  }
}

function TfButton({ active, onClick, children }: TfButtonProps) {
  const cls = active
    ? 'bg-tv-accent text-white'
    : 'text-tv-text-dim hover:text-tv-text hover:bg-tv-panel-hover';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 font-mono text-xs transition-colors ${cls}`}
    >
      {children}
    </button>
  );
}
