# SMC Footprint Backtester

Профессиональный полуавтоматический терминал для бэктеста торговых стратегий, объединяющий **Smart Money Concepts (SMC)** на старшем таймфрейме (HTF) и **Footprint** (кластерный анализ ордерфлоу) на младшем (LTF).

> **Парадигма:** Макро-контекст → Автоматический сканер → Микро-зум по клику.

---

## Состояние проекта

🟢 **MVP+ работает.** Текущая версия фронтенда — см. `version` в [`frontend/package.json`](./frontend/package.json) (на момент handoff'а — `1.17.13`).
Активно дорабатывается **Live-режим** (real-time графики через Binance WebSocket). Прогресс и журнал изменений — в [`PLAN.md`](./PLAN.md) и [`docs/04-live-mode.md`](./docs/04-live-mode.md).

---

## Быстрая навигация

| Файл | Что внутри |
|---|---|
| [`PLAN.md`](./PLAN.md) | **Главный документ** — план реализации с чекбоксами и журналом изменений. |
| [`docs/00-engineering-handoff.md`](./docs/00-engineering-handoff.md) | **Передача команды** — среда, тесты, процесс, ссылки на источники правды. |
| [`docs/01-spec.md`](./docs/01-spec.md) | Полная спецификация v3 «Fullscreen Pro»: workflow, UI/UX, визуализация, алгоритм сканера. |
| [`docs/02-roadmap.md`](./docs/02-roadmap.md) | Исходный поэтапный план разработки. |
| [`docs/03-data-format.md`](./docs/03-data-format.md) | Контракт формата данных (JSON/CSV) — единый для Python и фронтенда. |
| [`docs/04-live-mode.md`](./docs/04-live-mode.md) | Live-режим: WebSocket aggTrade, gap recovery, склейка с историей, TODO. |
| [`docs/prototype-reference.jsx`](./docs/prototype-reference.jsx) | Референсный React+SVG прототип (НЕ запускается, только для сверки логики). |
| `frontend/` | Production-фронтенд: Vite + React 19 + TypeScript + Tailwind + Canvas. |
| `data-pipeline/` | Python-агрегатор: Binance Vision AggTrades → JSON с кластерами. |

---

## Технологический стек

### Frontend (`frontend/`)

- **Vite 8** + **React 19** + **TypeScript 6** (strict)
- **Tailwind CSS 4** (тема в стиле TradingView)
- **Canvas API** для рендера свечей и футпринта (60 FPS на 100k+ свечей)
- **lucide-react** — иконки
- **Zod** — валидация загружаемых данных
- **idb** — IndexedDB-обёртка для автосохранения POI, кэша файлов и хвоста Live-свечей
- **Web Worker** для сканера (не блокирует UI)
- **Vitest** — unit-тесты (текущий статус: 281/281 ✅)
- **ESLint + Prettier** — линт и форматирование

### Data pipeline (`data-pipeline/`)

- **Python 3.11+** (минимум поддерживается 3.9; в проде — 3.11/3.12)
- **pandas** — агрегация тиков
- **requests** — скачивание Binance Vision
- **pydantic** — валидация выхода
- **pyarrow** — parquet-кэш
- **pytest** — тесты
- **ruff** — линт + форматер

---

## Текущая конфигурация

| Параметр | Значение |
|---|---|
| Поддерживаемые символы | `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `TONUSDT` |
| Период предсобранных датасетов | **7 дней** (файлы `frontend/public/{symbol}-7d.json`) |
| Пары таймфреймов (HTF/LTF) | `1h / 15m`, `1h / 5m`, `15m / 5m` |
| Single-режим (один график, без HTF/LTF) | `1h`, `15m`, `5m` |
| Live-режим | Binance WebSocket `aggTrade` + 24h pre-load REST klines |

15m / 1h свечи и кластеры строятся фронтендом автоматически из исходных 5m. Контракт данных и инварианты — [`docs/03-data-format.md`](./docs/03-data-format.md).

---

## Быстрый старт

### Frontend (предсобранные данные уже в репозитории)

```bash
cd frontend
npm install
npm run dev
# открыть http://localhost:5173
```

После запуска в UI можно сразу выбрать символ (BTC/ETH/SOL/BNB/TON) — данные подтянутся из `frontend/public/*-7d.json`. Кнопка **Demo** грузит локальный пресет, **Open JSON** — твой файл, **Live** — реальный поток с Binance.

### Data pipeline (своя выгрузка)

Нужно, только если хочешь свой символ / период / `tick_size`:

```bash
cd data-pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                                    # проверить, что окружение поднялось
smc-data BTCUSDT --days 7 --out ../frontend/public/btcusdt-7d.json
```

Подробнее по флагам — `smc-data --help` и [`data-pipeline/README.md`](./data-pipeline/README.md).

---

## Live-режим

Включается кнопкой **Live** в шапке. При старте:

1. Подгружает **24 часа** свежих klines Binance через REST для контекста (быстро, без кластеров).
2. Подключается к WebSocket `wss://stream.binance.com:9443/ws/{symbol}@aggTrade`.
3. Собирает живые 5m-свечи с **полным футпринтом** (Bid×Ask на каждом ценовом уровне) из тиков `aggTrade`.
4. На закрытии каждой 5m свечи запускает SMC-движок и сканер сигналов (Confirm-режим, без pre-signal на незакрытой свече).
5. Хвост live-свечей и `lastAggTradeId` сохраняются в IndexedDB → после reload восстанавливается без потерь (gap recovery через REST `aggTrades`).

Auto-reconnect с exponential backoff, throttle 250 мс на снапшоты UI, диагностика стрима (`тиков·кластеров·с момента посл. тика`) — справа в шапке.

Детали, архитектурная схема слоёв и список отложенных TODO — в [`docs/04-live-mode.md`](./docs/04-live-mode.md).

---

## SMC-индикаторы (HTF / Single)

Программная детекция и визуализация на основе 15m / 1h свечей:

- **FVG (Fair Value Gap)** — гэпы между свечами как зоны имбаланса.
- **Liquidity Pools / Sweeps** — кластеры экстремумов и их снятия (equal highs/lows).
- **CHoCH / BOS + Retest** — переломы структуры с маркером повторного теста.
- **Order Blocks** — ордер-блоки на сломах структуры.

В настройках SMC (popover по центру экрана) есть индивидуальные тогглы «скрывать отработанные» для каждого слоя (mitigated FVG, swept liquidity, retested structure, mitigated OB) и ссылка на встроенный гайд по интерпретации зон.

---

## Алгоритм сканера (4 правила, кратко)

Сигнал **LONG** на 5-минутной свече — все 4 условия одновременно:

1. `close > (high + low) / 2` — закрытие в верхней половине диапазона.
2. `total_delta > 0` — общий перевес покупок.
3. `close > vpoc_price` — закрытие выше уровня максимального объёма.
4. `delta_at_low < 0` — поглощение продаж на самом лое (агрессоры били вниз, но крупный лимитник впитал).

Сигнал **SHORT** — зеркальные условия. Подробности — в [`docs/01-spec.md` §5](./docs/01-spec.md).

В Live-режиме правила проверяются **только на закрытой 5m свече** (pre-signal на незакрытой — в отложенном TODO `04-live-mode.md` §«Отложено#1»).

---

## Скрипты разработки

### Frontend (`cd frontend`)

| Команда | Назначение |
|---|---|
| `npm run dev` | Vite dev-сервер на `http://localhost:5173` (порт освобождается автоматически через `predev`). |
| `npm run dev:fresh` | Тот же `dev`, но `--force` (сбрасывает кэш Vite). |
| `npm run build` | `tsc -b` + production-сборка. |
| `npm run preview` | Просмотр прод-сборки. |
| `npm run test` | Vitest в watch-режиме. |
| `npm run test:run` | Vitest один прогон (для CI). |
| `npm run test:ui` | Vitest UI. |
| `npm run typecheck` | `tsc -b --noEmit`. |
| `npm run lint` | ESLint. |

### Data pipeline (`cd data-pipeline`)

| Команда | Назначение |
|---|---|
| `pytest` | Тесты. |
| `ruff check .` | Линт. |
| `ruff format .` | Форматирование. |
| `smc-data <SYMBOL> --days N --out file.json` | Сборка датасета из Binance Vision. |

---

## Принципы разработки

| Принцип | Реализация |
|---|---|
| **Надёжность** | TypeScript strict, Zod-валидация датасетов, unit-тесты на сканер, агрегатор и live-слой. |
| **Удобство** | Hotkeys, undo, drag&drop, автосохранение разметки и live-хвоста в IndexedDB. |
| **Быстро** | Canvas с самого начала, виртуализация, Web Worker, throttle снапшотов в Live. |
| **Информативно** | Расширенный отчёт сканера, детальный StatusBar, тултипы по кластерам, live-диагностика стрима. |

---

## Источники данных

- **Binance Vision** — `https://data.binance.vision/data/spot/daily/aggTrades/{SYMBOL}/{SYMBOL}-aggTrades-YYYY-MM-DD.zip` — бесплатные daily-архивы, без API-ключа.
- **Binance REST** — `/api/v3/klines` (24h pre-load Live), `/api/v3/aggTrades` (gap recovery в Live).
- **Binance WebSocket** — `wss://stream.binance.com:9443/ws/{symbol}@aggTrade` (Live-стрим).

Приватные эндпоинты и API-ключи не используются — все источники публичные.

---

## Известные ограничения и долг

- **ESLint:** на момент handoff'а — 9 ошибок + 6 предупреждений (`react-hooks/refs`, `preserve-caught-error`, неиспользуемые директивы). Тесты и типы — зелёные. Кандидат №1 на следующий рефакторинг.
- **Live-режим:** часть UX отложена — pre-signal на незакрытой свече, мульти-символьные стримы, авто-старт live, звуковые алерты, tick-rate индикатор. Полный список и обоснование — в [`docs/04-live-mode.md`](./docs/04-live-mode.md) §«Отложено».
- **SMC incremental update:** на 50k+ свечах полный re-detect на каждом close 5m начнёт тормозить (>100 мс). Сейчас на 2k свечах — ~50 мс, оптимизация отложена.

---

## Лицензия

**MIT** — синхронизировано с [`data-pipeline/pyproject.toml`](./data-pipeline/pyproject.toml). Если для фронта планируется другая лицензия — нужно зафиксировать в `frontend/package.json` и обновить здесь.
