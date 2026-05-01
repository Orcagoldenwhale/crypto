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

### Этап 1. Каркас фронтенда

- [ ] `npm create vite@latest frontend -- --template react-ts`
- [ ] Установить: `tailwindcss`, `lucide-react`, `zod`, `idb`, `vitest`
- [ ] Настроить Tailwind с темой TradingView (`#131722`, `#1e222d`, `#2a2e39`, `#089981`, `#f23645`)
- [ ] Настроить `tsconfig.json` strict
- [ ] Настроить ESLint + Prettier
- [ ] Сделать макет: `Header` + основная область + плавающий `Toolbox` + `StatusBar` (без логики)
- [ ] **Чек:** `npm run dev` открывает пустой терминал в стиле TradingView.

---

### Этап 2. Типы данных и мок-генератор

- [ ] Описать TS-типы: `Cluster`, `Candle5m`, `Candle15m`, `POIZone`, `Signal`, `ScannerReport`
- [ ] Перенести `generateMockData` из прототипа → `data/mockGenerator.ts` с типами
- [ ] Реализовать `data/aggregator.ts` (5m → 15m)
- [ ] Unit-тесты агрегатора (`vitest`)
- [ ] Кнопка «Загрузить историю» → 1 440 мок-свечей за 5 дней
- [ ] **Чек:** в DevTools видим валидный массив свечей с кластерами.

---

### Этап 3. Canvas-рендер + Pan/Zoom + Crosshair ⏳ контрольная точка

- [ ] Компонент `ChartCanvas` с `useRef<HTMLCanvasElement>`
- [ ] Цикл рендера через `requestAnimationFrame`, перерисовка только при изменении viewport
- [ ] `engine/scale.ts`: `priceToY`, `yToPrice`, `timeToX`, `xToTime`
- [ ] Рендер сетки + ценовой оси (справа) + временной оси (снизу)
- [ ] Рендер классических свечей
- [ ] Pan (drag) и Zoom (wheel) с пивотом под курсором
- [ ] Crosshair поверх (отдельный canvas-overlay)
- [ ] Виртуализация по `domainX`
- [ ] **Чек:** 10 000 свечей рисуются и навигируются в стабильные 60 FPS.

---

### Этап 4. HTF↔LTF + рисование POI

- [ ] Toolbox с режимами: Pointer / Rectangle / Search / Trash + hotkeys (V/R/S/Backspace)
- [ ] Кнопка переключения 15m / 5m
- [ ] На 15m: drag создаёт `POIZone` с границами по цене и времени
- [ ] POI хранятся в state + автосохранение в IndexedDB
- [ ] Hit-testing зон (клик внутри → контекстное меню «Перейти на LTF»)
- [ ] Кнопка «Назад к HTF» в шапке
- [ ] **Чек:** зоны рисуются, переживают перезагрузку страницы.

---

### Этап 5. Footprint-кластера

- [ ] При 5m + ширине свечи > N px включать footprint-режим
- [ ] Heatmap дельты на ячейке кластера (зелёный/красный фон по интенсивности)
- [ ] Гистограмма объёма (полупрозрачная белая заливка, доля от `max_vol` свечи)
- [ ] VPOC — белая рамка вокруг ячейки максимального объёма
- [ ] Текст `Bid × Ask` по центру ячейки
- [ ] Подсветка имбалансов (≥2×) — жирный яркий цвет
- [ ] **Чек:** на zoom-in свеча раскрывается в кластера, текст не слипается.

---

### Этап 6. Сканер (4 правила) ⏳ контрольная точка MVP

- [ ] `scanner/checkSignal.ts` — чистая функция: 4 правила LONG / зеркальные SHORT
- [ ] Unit-тесты на 8+ кейсов
- [ ] Web Worker `scanner/worker.ts`
- [ ] Кнопка «Поиск входов» → worker → подсветка зон → маркеры на свечах
- [ ] Контекстное меню «Перейти на LTF» с авто-зумом ±45 мин padding
- [ ] Расширенный отчёт сканера: зон / успешных / LONG / SHORT / win-rate (заглушка для будущего)
- [ ] **Чек MVP:** размечаем зону → жмём поиск → переходим на LTF → визуально подтверждаем 4 правила.

---

### Этап 7. Data Pipeline на Python ⏳ контрольная точка

- [ ] `pyproject.toml` + `requirements.txt`
- [ ] `download.py` — скачивание Binance Vision daily aggTrades (5 zip-архивов)
- [ ] `aggregate.py` — pandas: тики → 5m кластера, OHLC, total_delta, vpoc_price, delta_at_low/high
- [ ] `schema.py` — pydantic-валидация выхода
- [ ] `cli.py` — `python -m smc_data BTCUSDT --start 2026-04-01 --days 5`
- [ ] Unit-тесты на тестовом наборе тиков
- [ ] **Чек:** 5 дней BTCUSDT обрабатываются за < 60 сек, JSON загружается во фронтенд через drag&drop, картинка идентична мок-режиму.

---

### Этап 8. UX-полировка

- [ ] Drag & drop CSV/JSON в окно
- [ ] Hotkeys: V / R / S / Esc / +/- / стрелки / Ctrl+Z (undo последней зоны)
- [ ] Расширенный StatusBar: символ, ТФ, OHLC под курсором, объём, дельта, время
- [ ] Тултип по наведению на кластер: цена, bid, ask, объём, дельта
- [ ] Toast-уведомления (загрузка / ошибки парсинга / поиск завершён)
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
