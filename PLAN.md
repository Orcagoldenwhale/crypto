# SMC Footprint Backtester — План реализации и прогресс

> **Живой документ.** Каждое изменение статуса этапа фиксируется здесь.
> Чекбоксы: `[ ]` — не начато, `[~]` — в работе, `[x]` — выполнено.

---

## Цель проекта

Полуавтоматический аналитический терминал для бэктеста торговых стратегий, объединяющий:

- **Макро (SMC)** — Smart Money Concepts на **15m** (HTF): пользователь руками размечает прямоугольниками зоны интереса (POI / Order Blocks / FVG).
- **Микро (Footprint)** — кластерный анализ ордерфлоу на **5m** (LTF): Bid×Ask на каждом ценовом уровне, дельта, VPOC, имбалансы, поглощения.

**Парадигма:** Макро-контекст → Автоматический сканер → Микро-зум по клику.

---

## Принципы (must-have)

| Принцип | Как реализуем |
|---|---|
| **Надёжность** | TypeScript strict, разделение слоёв, Zod-валидация на входе, unit-тесты на сканер и агрегатор. |
| **Удобство** | Hotkeys, undo, drag&drop CSV/JSON, автосохранение разметки в IndexedDB, понятный UI. |
| **Быстро** | Canvas-рендер с самого начала, виртуализация, Web Worker для сканера, requestAnimationFrame. |
| **Информативно** | Расширенный отчёт сканера (зоны / сигналы / win-rate), детальный StatusBar, тултипы по кластерам, лог действий. |

---

## Технологический стек (зафиксирован)

**Frontend:** Vite + React 18 + TypeScript (strict) + Tailwind CSS + lucide-react + Canvas API + IndexedDB (idb) + Zod + Vitest.

**Data pipeline:** Python 3 + pandas + requests + pydantic + pytest. Источник — **Binance Vision** (бесплатные daily/monthly архивы AggTrades, без API-ключа).

**Качество кода:** ESLint + Prettier (фронт), ruff + black (Python).

---

## Объём первого теста

| Параметр | Значение |
|---|---|
| HTF (рисование зон) | **15m** |
| LTF (поиск входов) | **5m** |
| Период | **5 календарных дней** |
| Инструмент | `BTCUSDT` |
| Свечей 5m | 1 440 |
| Свечей 15m | 480 |

---

## Целевая структура проекта

```
Crypto/
├── PLAN.md                          ← этот файл
├── README.md
├── .gitignore
├── docs/
│   ├── 01-spec.md                   ← из «Документация v3 (Fullscreen Pro).docx»
│   ├── 02-roadmap.md                ← из «План разработки.docx»
│   ├── 03-data-format.md            ← формализованная схема CSV/JSON
│   └── prototype-reference.jsx      ← из «Новый документ.docx»
├── data-pipeline/                   ← Этап 7
│   ├── pyproject.toml
│   ├── requirements.txt
│   ├── src/smc_data/
│   │   ├── download.py              ← Binance Vision
│   │   ├── aggregate.py             ← тики → 5m кластера
│   │   ├── schema.py                ← pydantic
│   │   └── cli.py
│   └── tests/
└── frontend/                        ← Этапы 1–6, 8–9
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── App.tsx
        ├── types/
        ├── data/        (loader, storage, mockGenerator, aggregator)
        ├── engine/      (renderer, candles, footprint, poi, scale)
        ├── scanner/     (checkSignal, runScanner, worker)
        ├── hooks/
        └── components/  (ChartCanvas, Header, Toolbox, ScannerReport, StatusBar, ZoneMenu, DropZone)
```

---

## Этапы

Контрольные точки (остановка на ревью): **0, 3, 6, 7**.

### Этап 0. Фундамент проекта ✅ контрольная точка пройдена

- [x] Создать `PLAN.md` (этот файл)
- [x] Создать структуру папок `docs/`, `data-pipeline/`, `frontend/`
- [x] Конвертировать `Документация v3 (Fullscreen Pro).docx` → `docs/01-spec.md`
- [x] Конвертировать `План разработки.docx` → `docs/02-roadmap.md`
- [x] Сохранить код прототипа в `docs/prototype-reference.jsx`
- [x] Создать `docs/03-data-format.md` (схема кластеров)
- [x] Создать корневой `README.md` (описание + quick-start + навигация)
- [x] Создать `.gitignore`
- [x] Инициализировать `git` (ветка `main`)
- [x] **Чек:** структура читаема, документация конвертирована, оригинальные `.docx` не повреждены.

---

### Этап 1. Каркас фронтенда ✅

- [x] `npm create vite@latest frontend -- --template react-ts` (Vite 8, React 19, TS 6)
- [x] Установить: `tailwindcss` v4, `@tailwindcss/vite`, `lucide-react`, `zod`, `idb`, `vitest`, `prettier`
- [x] Настроить Tailwind v4 с темой TradingView через `@theme` (`tv-bg`, `tv-panel`, `tv-up`, `tv-down`, `tv-accent` и др.)
- [x] Настроить `tsconfig.app.json` strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + path alias `@/*`
- [x] Настроить `.prettierrc` (single quotes, semi, trailing comma, 100 width)
- [x] Сделать макет: `Header` + `Toolbox` (плавающий) + `ChartCanvas` (заглушка) + `StatusBar` (без бизнес-логики)
- [x] Очистить демо-ассеты Vite (logos, hero.png, App.css, icons.svg)
- [x] **Чек:** `npm run dev` запускает терминал в стиле TradingView на `http://localhost:5174/`, HTTP 200, TS-компиляция без ошибок.

---

### Этап 2. Типы данных и мок-генератор ✅

- [x] Описать TS-типы: `Cluster`, `Candle5m`, `Candle15m`, `POIZone`, `Signal`, `ScannerReport`, `Dataset`, `DatasetMeta`, `Timeframe`, `SignalType` (`src/types/index.ts`)
- [x] Перенести `generateMockData` из прототипа → `data/mockGenerator.ts` с типами и **детерминированным RNG (mulberry32)**
- [x] Реализовать `data/aggregator.ts` (5m → 15m, чистая функция)
- [x] Unit-тесты агрегатора (`vitest`) — 7 кейсов, включая 1440→480
- [x] Unit-тесты мок-генератора — 19 кейсов: все инварианты `docs/03-data-format.md`, детерминированность, "идеальные" сетапы LONG/SHORT
- [x] Vitest-конфиг (`vitest.config.ts`) + npm-скрипты `test`, `test:run`, `test:ui`, `typecheck`
- [x] Кнопка «Загрузить историю» → 1 440 мок-свечей за 5 дней + агрегация в 480 × 15m + лог в DevTools
- [x] Унификация типа `Timeframe` (один источник правды в `@/types`)
- [x] **Чек:** `npm run test:run` → **26/26 тестов прошли**, `npx tsc -b --noEmit` — без ошибок, в DevTools после клика виден валидный массив свечей с кластерами.

---

### Этап 3. Canvas-рендер + Pan/Zoom + Crosshair ✅ контрольная точка пройдена

- [x] Компонент `ChartCanvas` с **двумя слоями `<canvas>`** (main + overlay) для производительности
- [x] Цикл рендера через `requestAnimationFrame`, перерисовка только при изменении viewport
- [x] **HiDPI-поддержка** через `devicePixelRatio` + `setTransform` — чёткие линии и текст на Retina
- [x] **ResizeObserver** + `window.resize` для адаптивной перерисовки при ресайзе окна
- [x] `engine/scale.ts`: `priceToY`, `yToPrice`, `timeToX`, `xToTime`, `candleWidthPx`, `findVisibleRange` (бинарный поиск O(log n)), `fitPriceRange` (авто-фит цены)
- [x] `engine/grid.ts`: рендер сетки + ценовая ось справа + временная ось снизу + «красивые» шаги тиков (1/2/5×10ⁿ для цены, выбор из 1m/5m/15m/.../1w для времени) + бэйджи под курсором на осях
- [x] `engine/candles.ts`: рендер классических OHLC-свечей с батчингом по цвету
- [x] `engine/crosshair.ts`: рендер перекрестия на overlay-слое с пунктиром
- [x] `hooks/useChartViewport.ts`: pan/zoom-state, обработчики мыши, авто-фит цены, `resetView`, `zoomToTimeRange`
- [x] Pan (drag), Zoom (wheel с пивотом под курсором, ограничение `MIN_VISIBLE_CANDLES=5`)
- [x] **Виртуализация** через `findVisibleRange` (бинарный поиск, рисуем только видимые свечи + 1 в каждую сторону)
- [x] Wheel-listener — нативный non-passive чтобы `preventDefault` сработал
- [x] Переключатель `15m`/`5m` в углу графика (timeframe state в App)
- [x] Unit-тесты движка (`scale.test.ts`) — 24 кейса: обратимость преобразований, edge-cases (range=0), производительность бинарного поиска (100k свечей за < 5 мс)
- [x] **Чек:** все 50 тестов проходят, TS-компиляция чистая, 1440 5m свечей и 480 15m рисуются мгновенно, навигация плавная.

---

### Этап 4. HTF↔LTF + рисование POI ✅

- [x] Toolbox с режимами Pointer / Rectangle / Scanner / Trash + hotkeys (V / R / S / Esc / Delete / Backspace)
- [x] Кнопка переключения 15m / 5m (учитывает закрытие меню и нормализацию инструмента)
- [x] На 15m: drag-режим создаёт `POIZone` с нормализованными границами (min/max по цене и времени), отсечение случайных кликов через `MIN_DRAG_PX = 6`
- [x] POI хранятся в state + автосохранение в IndexedDB (`src/data/storage.ts`, обёртка над `idb`), со skip первого рендера
- [x] Hit-testing зон через `engine/poi.ts::hitTestZones` (последняя нарисованная — приоритетнее) → клик показывает `ZoneMenu` (закрытие по клику снаружи и `Esc`)
- [x] «Перейти на 5m» в меню зоны — переключает таймфрейм + `zoomToTimeRange` с padding 45 минут (через `ChartViewportApi`)
- [x] Кнопка «Назад к HTF» в шапке — `resetView()` + переключение на 15m
- [x] Подсказка-режим «Режим разметки …» при `tool=rectangle` на 15m
- [x] Подтверждение `confirm()` при «Очистить всё»
- [x] +7 unit-тестов на POI engine (`engine/poi.test.ts`: hit-test для пустого / попадания / промаха / перекрытия / инвертированной зоны), всего **62/62**
- [x] Хотфикс `kill-port.mjs`: ожидание реального освобождения TCP-сокета (до 1500мс) — устраняет race с EADDRINUSE при `predev`
- [x] **Чек:** зоны рисуются, выделяются жёлтой рамкой, открывают меню, переходят на 5m с зумом и переживают перезагрузку страницы.

---

### Этап 5. Footprint-кластера ✅

- [x] При 5m + ширине свечи ≥ `FOOTPRINT_MIN_WIDTH_PX = 50` включается footprint-режим (`shouldRenderFootprint`)
- [x] Heatmap дельты на ячейке кластера (зелёный для `delta>0`, красный для `delta<0`, альфа = `min(|delta|/max_vol, 0.5)` — устойчивая нормировка к разным абсолютным масштабам)
- [x] Гистограмма объёма (полупрозрачная белая заливка слева, доля от `max_vol` свечи)
- [x] VPOC — жирная (`lineWidth=1.5`) белая рамка вокруг ячейки `price === vpoc_price`
- [x] Текст `Bid × Ask` по центру ячейки (только при `cellHeight ≥ 12px` и `cellW ≥ 36px` — не слипается)
- [x] Подсветка имбалансов (`≥ 2×`): bid красным жирным при `bid > ask·2`, ask зелёным жирным при `ask > bid·2`
- [x] Тонкая центральная линия high-low в footprint-режиме — сохраняет визуальную форму свечи
- [x] Fallback на классический рендер для свечей без полноценных кластеров (`< 2` уровней) — корректно работает с Binance-синтезом
- [x] +9 unit-тестов (`engine/footprint.test.ts`): порог включения, корректное число ячеек, имбалансы, VPOC `lineWidth`, fallback. Всего **71/71**.
- [x] **Чек:** при zoom-in на 5m свеча раскрывается в кластера, текст не слипается, VPOC чётко выделен, имбалансы видны мгновенно.

---

### Этап 6. Сканер (4 правила) ✅ контрольная точка MVP пройдена

- [x] `src/scanner/checkSignal.ts` — чистая функция, 4 правила LONG (polarity / totalDelta / closeVsVpoc / absorption) + зеркальные SHORT, возвращает `SignalCheck` с диагностикой по каждому правилу для отладки
- [x] `src/scanner/runScanner.ts` — проход по всем 5m-свечам в зонах, через утилиту `candleInZone` (пересечение по времени + цене); собирает `signals[]`, `zoneIdsWithSignal`, `report`
- [x] **Web Worker** `src/scanner/scannerWorker.ts` — выполнение в фоне через `new Worker(new URL(..), { type: 'module' })`, переиспользуется (не пересоздаётся при каждом запуске)
- [x] Unit-тесты `checkSignal.test.ts` — **17 кейсов**: positives + 4 near-miss negatives для LONG / 4 для SHORT, 7 кейсов на `candleInZone`
- [x] Unit-тесты `runScanner.test.ts` — **6 кейсов**: пустые входы, LONG/SHORT positives, временные/ценовые границы зоны, корректность report при нескольких зонах
- [x] **Интеграционный тест** `integration.test.ts` — **4 кейса**: сканер находит именно те «идеальные» свечи, которые внедрил `mockGenerator` на индексах 40% (LONG) и 65% (SHORT)
- [x] `src/engine/signals.ts` — рендер маркеров на 5m: ▲ зелёный под low для LONG, ▼ красный над high для SHORT, тонкая привязочная линия от свечи к маркеру при `cwPx ≥ 6`
- [x] Кнопка `S` в Toolbox / hotkey `S` → запуск воркера → подсветка зон с сигналами (`zone.hasSignal=true` → плотная зелёная рамка) → маркеры на свечах
- [x] HTF→LTF zoom при «Перейти на 5m» из меню зоны: ±45 мин padding (унаследовано из Stage 4)
- [x] `src/components/ScannerReport.tsx` — floating-панель внизу справа: Зон всего / Со сигналом / LONG / SHORT / время выполнения в воркере (ms). Сворачивается, закрывается.
- [x] StatusBar показывает количество найденных сигналов
- [x] **Все 98/98 тестов** (9 файлов): aggregator, mockGenerator, scale, binanceLoader, poi, footprint, checkSignal, runScanner, integration. Lint и typecheck чистые.
- [x] **Чек MVP:** Демо → разметка POI на 15m → `S` → найдены LONG (40%) и SHORT (65%) → клик «Перейти на 5m» → визуально подтверждаются 4 правила (footprint, VPOC, поглощение).

---

### Этап 7. Data Pipeline на Python ✓ контрольная точка пройдена

- [x] `pyproject.toml` + `requirements.txt` + `requirements-dev.txt` + `README.md`
- [x] `download.py` — fetch_day с retry/backoff, parquet-кэш, авто-детект μs/ms
- [x] `aggregate.py` — pandas: тики → 5m кластера, OHLC, total_delta, vpoc_price, delta_at_low/high
- [x] `schema.py` — pydantic-валидация выхода (инварианты: vol=bid+ask, Σcluster=candle, VPOC, сортировка)
- [x] `cli.py` — `smc-data BTCUSDT --days 5 --start ... --out ...`
- [x] Unit-тесты на синтетических тиках (24/24 passing, ruff clean)
- [x] **Реальная скачка боевых данных:** 5 дней BTCUSDT, 3.27M тиков → 1440 свечей × 5m = 4.94 MB JSON, агрегация ≈ 1 сек.
- [x] **Drag & drop во фронт:** `useDropZone` + `DropOverlay` + кнопка «Открыть JSON» в Header. Zod-схема `datasetSchema.ts` зеркалит Pydantic 1:1. Авто-загрузка `/btcusdt-5d.json` при старте.
- [x] **Чек:** 5 дней BTCUSDT обрабатываются за **~5 сек** (включая скачивание ZIP), JSON загружается во фронтенд через drag&drop И через автоподгрузку, контракт Python↔TS подтверждён e2e-тестом.

---

### Этап 8. UX-полировка

- [x] **8.1 Detailed Trade View** — кликабельные сигналы, hover, золотая подсветка свечи, 4 бэйджа условий, карточка сделки внизу-слева, prev/next по `←`/`→`. См. журнал.
- [x] **8.2 Контекст под курсором** — расширенный StatusBar (OHLCV/Δ/время свечи) + тултип по кластеру в footprint (price / bid×ask / vol / Δ + подсветка имбаланса 2×) + голубая обводка ячейки на hover.
- [x] **8.3 Undo/Redo** — `Ctrl/Cmd+Z` отменяет, `Ctrl/Cmd+Shift+Z` или `Ctrl+Y` повторяют. Покрыты: создание / удаление зоны / clearAll. Кнопки в Toolbox с автоматическим disable.
- [ ] **8.4** Toast-уведомления (загрузка / ошибки парсинга / поиск завершён)
- [x] **8.5** Drag & drop JSON в окно (реализован в рамках Этапа 7.7)
- [ ] **Чек:** все основные сценарии достижимы без мыши.

---

### Этап 9. Производительность

- [ ] Профилирование на 100 000 свечей
- [ ] Off-screen canvas для footprint, кэш текстур цифр
- [ ] IndexedDB-кэш распарсенных JSON
- [ ] Дебаунс перерисовки при ресайзе
- [ ] **Чек:** 100k свечей грузятся < 2 сек, навигация — стабильные 60 FPS.

---

## Журнал изменений

| Дата | Этап | Что сделано |
|---|---|---|
| 2026-05-01 | — | Создан `PLAN.md`, зафиксирован стек и объём первого теста (5 дней BTCUSDT, 15m / 5m). |
| 2026-05-01 | 0 | Создана структура папок (`docs/`, `data-pipeline/`, `frontend/`). Три `.docx` конвертированы в Markdown без потери смысла, оригиналы не повреждены. Создан `docs/03-data-format.md` с формализованной схемой данных (контракт между Python и фронтом). Созданы `README.md` и `.gitignore`. Инициализирован git-репозиторий с веткой `main`. **Этап 0 завершён.** |
| 2026-05-01 | 1 | Развёрнут Vite 8 + React 19 + TypeScript 6 (strict + noUncheckedIndexedAccess) + Tailwind CSS v4 + lucide-react + zod + idb + vitest + prettier. В Tailwind через `@theme` прописана палитра TradingView. Создана структура `src/` (components/types/data/engine/scanner/hooks/tests). Реализован пустой макет: `Header`, `Toolbox` (с 4 инструментами), `ChartCanvas` (заглушка), `StatusBar`. Демо-ассеты Vite вычищены. Dev-сервер работает на `http://localhost:5174/`. **Этап 1 завершён.** |
| 2026-05-01 | 2 | Описаны строгие TS-типы доменной модели в `src/types/index.ts` (контракт точно соответствует `docs/03-data-format.md`). Реализован детерминированный мок-генератор `src/data/mockGenerator.ts` (mulberry32, фиксированный seed) — 1440 свечей за 5 дней с двумя «идеальными» сетапами LONG (i=576) и SHORT (i=936), всеми кластерами и инвариантами формата. Реализован агрегатор `src/data/aggregator.ts` (5m→15m, чистая функция). Vitest-конфиг + npm-скрипты `test`/`typecheck`. Покрытие тестами: **26/26 тестов прошли** (7 на агрегатор + 19 на мок: инварианты, детерминированность, корректность 4 правил для идеальных сетапов). Кнопка «Загрузить историю» теперь генерирует 1440 LTF + 480 HTF свечей и логирует структуру в DevTools. Унифицирован источник `Timeframe`. **Этап 2 завершён.** |
| 2026-05-01 | 3 | Реализован полноценный Canvas-движок графика с двумя слоями (main + overlay для перекрестия). HiDPI-рендер через DPR + ResizeObserver. Чистые функции движка в `src/engine/` (`scale.ts`, `grid.ts`, `candles.ts`, `crosshair.ts`) — все детерминированные, тестируемые. Бинарный поиск видимого диапазона `findVisibleRange` за O(log n) (на 100k свечей укладывается в < 5 мс). Авто-фит цены под видимые свечи с 5% padding. Хук `useChartViewport` с pan/zoom (wheel — пивот под курсором, drag — сдвиг). Сетка с «красивыми» тиками 1/2/5×10ⁿ для цены и адаптивными шагами времени (1m/5m/15m/.../1w). Бэйджи цены/времени под курсором на осях. Переключатель 15m/5m в углу графика. **Все 50 тестов прошли** (50 = 26 предыдущих + 24 новых на движок). **Этап 3 (контрольная точка) завершён.** |
| 2026-05-01 | hotfix | Подключение Binance REST API klines (`src/data/binanceLoader.ts`) с пагинацией, retry/backoff, AbortController, Zod-валидацией. Кнопка «Загрузить историю» теперь грузит реальный BTCUSDT за 5 дней с автоматическим fallback на мок при недоступности API. StatusBanner показывает прогресс/успех/ошибку. **+5 тестов на loader (55/55 итого).** Доработка инфраструктуры: `predev`-хук + кросс-платформенный `scripts/kill-port.mjs` (lsof/netstat) автоматически зачищает порт 5173 перед запуском. `strictPort: true` в Vite-конфиге → исключены ситуации с зомби-серверами на разных портах. URL стабильно `http://localhost:5173/`. |
| 2026-05-01 | 4 | Реализованы рисование POI-зон, IndexedDB-persistence, hit-test и HTF↔LTF навигация. Добавлены: `src/data/storage.ts` (idb-обёртка, ключ — символ), `src/engine/poi.ts` (рендер зон + draft + hit-test, +7 тестов), `src/hooks/usePOIDrawing.ts` (drag-машина с min-size фильтром), `src/hooks/useHotkeys.ts` (V/R/S/Esc/Del/Backspace, игнорит input/textarea), `src/components/ZoneMenu.tsx` (контекстное меню «Перейти на 5m» / «Удалить»). `ChartCanvas` переписан под новые инструменты: тип курсора зависит от tool, draft рендерится на overlay-canvas (не дёргает свечи). `App.tsx` управляет жизненным циклом зон и зумом через `ChartViewportApi`-callback. Хотфикс `kill-port.mjs`: активный поллинг до фактического освобождения сокета. **Все 62/62 теста зелёные, lint и typecheck чистые.** **Этап 4 завершён.** |
| 2026-05-01 | 5 | Реализован Footprint-режим (`src/engine/footprint.ts`). Авто-включение при 5m + ширина свечи ≥ 50px. Каждая 5m-свеча раскрывается в столбик ячеек по числу уровней `clusters[]`: heatmap дельты (нормировка через `max_vol`), полупрозрачная гистограмма объёма, белая рамка VPOC (`lineWidth=1.5`), текст `B × A` с подсветкой имбалансов 2× (bid красным / ask зелёным жирным). Тонкая центральная линия high-low сохраняет форму свечи. Fallback на классические свечи для свечей с `clusters.length < 2` (Binance-синтез) — корректно сосуществует с настоящими кластерами. ChartCanvas автоматически выбирает renderer через `shouldRenderFootprint`. **+9 тестов, всего 71/71. Lint/typecheck чистые.** **Этап 5 завершён.** |
| 2026-05-02 | 5+ | Подготовка к реальным aggTrades (preview Этапа 7): добавлены `src/data/visionLoader.ts` (скачивание daily zip с Binance Vision через Vite-proxy, fflate-распаковка, потоковый парсинг CSV в Candle5m с настоящими кластерами), кэш дней в IndexedDB через `loadVisionDay/saveVisionDay`, новая кнопка «Демо» в шапке для мгновенного просмотра моковых кластеров, прогресс-баннер с детализацией по этапам (cache/download/unzip/parse). Vite proxy `/vision/* → data.binance.vision/*` решает CORS в dev. Работает только при запуске Vite в среде с DNS-доступом к интернету; иначе fallback на REST klines. |
| 2026-05-02 | 6 | **MVP пройден.** Реализован сканер 4 правил: `src/scanner/checkSignal.ts` (чистая функция с диагностикой по каждому правилу), `runScanner.ts` (проход по зонам с `candleInZone` пересечением), `scannerWorker.ts` (Web Worker с переиспользуемым инстансом). Маркеры сигналов рендерятся в `src/engine/signals.ts` (▲ под low для LONG, ▼ над high для SHORT, привязочная линия от свечи к маркеру). Зоны с сигналом подсвечиваются `hasSignal: true` → плотная зелёная рамка + ярче заливка. `ScannerReport`-панель показывает сводку и время выполнения в воркере. **27 новых тестов** (17 на checkSignal/candleInZone, 6 на runScanner, 4 интеграционных через mockGenerator), **всего 98/98**. Интеграционный тест верифицирует, что сканер находит именно те свечи, что mock-генератор сознательно отметил как «идеальные» (40% и 65% датасета). **Этап 6 (контрольная точка MVP) завершён.** |
| 2026-05-02 | versioning | **Версионирование UI v1.7.0.** Введён `src/version.ts` (единственный источник правды), Vite через `define` инжектирует `__BUILD_TIME__` в каждый бандл. Версия и время сборки видны: в Header (`v1.7.0 · 13:18`), в StatusBar (`SMC Footprint · v1.7.0`), во вкладке (`SMC Terminal v1.7.0`) и в console при старте (цветной бэйдж). `package.json` поднят до `1.7.0`. **Защита от старого фронта:** `main.tsx` при старте снимает все service-workers и чистит CacheStorage; `index.html` + dev-middleware шлют `Cache-Control: no-store`; `kill-port.mjs` дополнительно чистит `node_modules/.vite` (Vite dependency cache); добавлен скрипт `npm run dev:fresh` (kill-port + Vite `--force` re-bundle). Все 98/98 тестов и typecheck чистые, dev-сервер стабильно поднимается на `http://localhost:5173/`. |
| 2026-05-03 | multi-symbol + tick (v1.13.0) | **Мульти-символ (BTC / ETH / SOL) + регулируемый размер ячейки footprint.** Скачаны и положены в `frontend/public/` датасеты `ethusdt-5d.json` (tick 0.5) и `solusdt-5d.json` (tick 0.05) — Python pipeline. Каталог инструментов в `data/symbols.ts` (id, short, long, tickSize, prebuiltUrl) — единая точка регистрации новых тикеров. Persistence настроек: `data/tickPreference.ts` хранит symbol и `TickPref` (`'auto'` или `{ manual: 1\|2\|5\|10 }`) в localStorage; на старте читается, при изменении сохраняется. Чистая функция `engine/regroupClusters.ts`: `regroupCandle` объединяет ячейки по укрупнённой сетке (целочисленные индексы в исходной grid'е → нет drift'а floating-point на дробных tick), пересчитывает VPOC/max_vol/delta_at_low/high под новую геометрию (иначе сканер бы читал «старые» поля). `regroupCandles` при mul=1 возвращает тот же массив (referential equality). `computeAutoMultiplier` выводит ×N по средней плотности кластеров (≤25→×1, ≤60→×2, ≤150→×5, иначе ×10). UI: `SymbolPicker` (dropdown в Header — BTC/USDT, ETH/USDT, SOL/USDT, закрытие по клику-вне/Esc), `TickPicker` (dropdown справа от ТФ-переключателя, виден только в 5m, в режиме «авто» показывает финальный множитель). App.tsx теперь работает per-symbol: загрузка датасета и зон через `useEffect([symbol])`, при смене символа viewport ресетится, scanner-state очищается. Сценарий работы: `data5m = useMemo(regroupCandles(rawData5m, effectiveMultiplier))` идёт и в ChartCanvas, и в сканер — обе подсистемы видят одну и ту же сетку, никаких рассинхронов. **+29 тестов** (`detectBaseTickSize`, `regroupCandle` для no-op/базовой группировки/VPOC/delta_at_low/high/дробных tick (SOL,ETH)/дыр, `regroupCandles` сохранение референса, `computeAutoMultiplier` пороги). **Всего 182/182**, lint и typecheck чистые. |
| 2026-05-03 | bonus (v1.12.0) | **Бонус-индикаторы качества сигнала.** Добавлены ДВА необязательных условия (не влияют на наличие сигнала, только показывают «жирный» он или нет): **(1) Имбалансы потока** — счётчик одноцветных кластеров `ask ≥ 2×bid` (бычий) для LONG / `bid ≥ 2×ask` (медвежий) для SHORT; нулевые ячейки явно исключены, чтобы не дублировать второй бонус. **(2) Нуль на экстремуме** — для LONG проверяем `ask == 0` на самом нижнем кластере (auction exhaustion вниз), для SHORT — `bid == 0` на самом верхнем. Архитектурно: `SignalDiagnostics` расширен (`imbalanceCount` / `imbalancePrices` / `hasZeroAtExtreme`), `buildDiagnostics(candle, type)` теперь принимает направление, экспортированы чистые `countImbalances` / `detectZeroAtExtreme`. UI: `TradeDetailPanel` получил блок «Бонус · необязательно» с двумя строками (зелёная/красная подсветка по направлению, hint-текст подсказывает интерпретацию). `engine/highlights.ts` рисует на свече выбранного сигнала точки-маркеры на каждой имбаланс-ячейке (только в footprint) и бэйдж «0 на low/high · аукцион исчерпан». **+9 тестов**, **153/153 пройдено**, lint и typecheck чистые. |
| 2026-05-02 | bugfix (v1.11.2) | **Адаптивный формат объёмов в footprint.** Репорт: на BTCUSDT кластеры показывали "0 × 0", "1 × 0" и т.п. — потому что `Math.round(cluster.bid)` превращал 0.3-0.7 BTC в 0 или 1. Введена функция `formatClusterVol(v)`: 0 → "0", <1 → две десятичных ("0.42"), <10 → одна ("3.5"), <1000 → целое, ≥1000 → "1.2k". Минимальная ширина ячейки для текста поднята с 36 до 48 px. **+7 тестов**, **144/144 пройдено**. |
| 2026-05-02 | hotfix (v1.11.1) | **Фикс задвоения зон и сигналов.** Репорт юзера: 3 нарисованных зоны → отчёт сканера показывает «Зон всего: 6, Со сигналом: 6, LONG: 4, SHORT: 8» (всё в 2 раза больше). Корневая причина: в `usePOIDrawing.ts` `onCreate(prev)` вызывался ВНУТРИ функционального апдейтера `setDraft(...)`, который React Strict Mode (default Vite) намеренно вызывает дважды для проверки чистоты — каждое отпускание мыши создавало 2 зоны с разными UUID, но идентичными координатами. Дубли накладывались на canvas → визуально 3, а в state 6 → сканер находил вдвое больше сигналов. Фикс: ввёл `draftRef` как источник правды, `setDraft` теперь чистый, побочный эффект `onCreate(finalDraft)` вызывается СНАРУЖИ — гарантированно один раз. Бонус-фикс: в `handleRunScanner` 5-секундный setTimeout-fallback читал `scannerRunning` из stale-замыкания (всегда `true`) и мог дублировать результат — заменил на `scannerRunningRef` + `applied`-гард. Дедупликация существующих дублей: новый модуль `data/dedupeZones.ts` (+6 тестов на регрессию), `App.tsx` чистит результат `loadPOIs()` при старте, чтобы юзеры с уже задвоенными зонами в IndexedDB получили чистую разметку. **137/137 тестов**, lint и typecheck чистые. |
| 2026-05-02 | 7 (v1.11.0) | **Этап 7 — реальные данные.** Создан Python-пакет `data-pipeline/smc_data` (Python 3.9+, pyproject + requirements + README). Pydantic-схемы (`schema.py`) с проверкой всех инвариантов: vol=bid+ask, Σcluster=candle, VPOC=кластер с max vol, сортировка кластеров и свечей, alignment timestamp на 5m. `download.py` — fetch с Binance Vision (`data.binance.vision`), HTTP-retry с exponential backoff, parquet-кэш в `~/.smc-cache` или `--cache-dir`, авто-детект μs/ms timestamps в новых архивах. `aggregate.py` — чистый pandas один-проход (numpy.where для bid/ask без apply): groupby (window, bucket) → кластеры → мерж с OHLC → delta_at_low/high. CLI `smc-data BTCUSDT --days 5 --start ... --out ...` с прогресс-логом по дням. **24/24 pytest-тестов** (схема + агрегация + ZIP-парсер с обеими версиями формата), ruff clean. **Реальная скачка боевых данных:** 5 дней BTCUSDT (26-30 апр 2026), 3 274 543 тиков → 1440 свечей × 5m, 4.94 MB JSON, всё за ~5 секунд. **Frontend интеграция (v1.11.0):** Zod-схема `datasetSchema.ts` зеркалит Pydantic 1:1 (12 тестов на инварианты, +1 e2e на реальный JSON). `datasetLoader.ts` (file/URL/drag&drop helper). Хук `useDropZone` (counter-based dragenter/leave) + компонент `DropOverlay` для полноэкранного визуала. Кнопка «Открыть JSON» в Header. Автоподгрузка `/btcusdt-5d.json` при старте (404 — тихо игнорим). **Всего 131/131 фронт-тест + 24/24 Python**, lint и typecheck чистые. |
| 2026-05-02 | 8.3 (v1.10.0) | **Undo / Redo для операций с зонами.** Расширен `useHotkeys` под комбинации с модификаторами: формат ключа `mod+z` / `mod+shift+z` / `mod+y` (`mod` = Ctrl на Win/Linux и Cmd на macOS). Игнорим Alt-комбо и чистые модификаторы. Введён generic-стек `createUndoStack<T>()` (чистая фабрика — без React, тестируется напрямую) + тонкий хук-обёртка `useUndoStack<T>()`. Семантика: history/future, push сбрасывает future (классическая ловушка undo), maxSize=50 с отбрасыванием старых. App: три операции с зонами (`create` / `delete` / `clear`) обёрнуты в reversible action-ы с замыканиями над snapshot-ами. Hotkeys: `Ctrl/Cmd+Z` — undo, `Ctrl/Cmd+Shift+Z` или `Ctrl+Y` — redo. Toolbox получил две новые кнопки (`Undo2` / `Redo2`) с автоматическим disable, тултип показывает символ ⌘ на macOS и `Ctrl` на остальных. Реактивность: историю сделали реактивной через `historyVersion`-счётчик в `useState` — кнопки enable/disable обновляются мгновенно. Версия фронта поднята до **1.10.0**. **+7 тестов** (`createUndoStack`: пустой, push/undo, undo/redo, инвалидация future, LIFO, лимит истории, clear). **Всего 119/119 тестов**, lint и typecheck чистые. |
| 2026-05-02 | 8.2 (v1.9.0) | **Контекст под курсором — расширенный StatusBar + тултип кластера.** Новые чистые модули: `engine/hitTest.ts` (`hitTestCandle` через бинарный поиск по timestamp, O(log n)) и расширение `engine/footprint.ts` (`computeClusterHitboxes` + `hitTestCluster` + `renderClusterHover`). ChartCanvas теперь отдаёт наружу `hoveredCandle` (для StatusBar) и `hoveredCluster` (для тултипа), с автоинвалидацией при смене viewport/timeframe. StatusBar полностью переверстан: левый блок (Symbol/TF/Candles), центральный плавающий блок OHLCV+Δ+время свечи под курсором (зелёный/красный по направлению свечи, цвет Δ по знаку), правый блок (POI/Signals/версия). Новый компонент `ClusterTooltip.tsx` — `fixed`-позиционирование по clientX/Y с auto-flip у краёв окна; показывает price/bid/ask/vol/Δ; подсветка имбаланса 2× жирным цветом + бэйдж «⚡ imb 2×». На overlay-canvas — голубая обводка hovered-ячейки (отличается от золотого «выбрано» и белого VPOC). Версия фронта поднята до **1.9.0**. **+10 тестов** (`hitTestCandle` × 6, `computeClusterHitboxes`+`hitTestCluster` × 4). **Всего 112/112 тестов**, lint и typecheck чистые. |
| 2026-05-02 | 8.1 (v1.8.0) | **Detailed Trade View — кликабельные сигналы с разбором 4 правил.** Контракт `Signal` расширен: `id` (детерминированный `${zoneId}::${ts}::${type}`) + `diagnostics` (open/high/low/close/mid/totalDelta/vpoc/delta_at_low/high/vol_at_low/high). Новая чистая функция `buildDiagnostics(candle)` собирает метрики с тем же определением правил, что в `checkSignal`. Маркеры сигналов теперь кликабельны: `engine/signals.ts` экспортирует `computeSignalHitboxes` + `hitTestSignals`; ChartCanvas на 5m в pointer-режиме слушает hover/click — курсор `pointer`, выбранный маркер крупнее, золотая обводка + внешнее свечение. Новый модуль `engine/highlights.ts` — на свече сигнала рисуется золотая Г-рамка (TradingView-style) и 4 бэйджа с реальными значениями: mid, Δ, VPOC vs close, Δ@low/high; в footprint-режиме ячейка экстремума получает оранжевую обводку. Новый компонент `TradeDetailPanel` (внизу-слева) — карточка с типом/временем/ценой и 4 строками условий (значения + объяснение); prev/next-навигация. App: `selectedSignalId` state, `handleSelectSignal` (с авто-переключением на 5m и центрированием при клике на 15m), `handleNavigateSignal(±1)`, hotkeys `←` / `→` / `Esc`. Версия фронта поднята до **1.8.0**. **+4 теста** (buildDiagnostics × 3, signal id+diagnostics в runScanner × 1). **Всего 102/102 теста**, lint и typecheck чистые. |
