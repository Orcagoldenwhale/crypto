# SMC Footprint Backtester

Профессиональный полуавтоматический терминал для бэктеста торговых стратегий, объединяющий **Smart Money Concepts (SMC)** на 15-минутном графике и **Footprint** (кластерный анализ ордерфлоу) на 5-минутном.

> **Парадигма:** Макро-контекст → Автоматический сканер → Микро-зум по клику.

---

## Состояние проекта

🟡 **В разработке.** Текущий этап и прогресс — в [`PLAN.md`](./PLAN.md).

---

## Быстрая навигация

| Файл | Что внутри |
|---|---|
| [`PLAN.md`](./PLAN.md) | **Главный документ** — план реализации с чекбоксами и журналом изменений. |
| [`docs/01-spec.md`](./docs/01-spec.md) | Полная спецификация v3 «Fullscreen Pro»: workflow, UI/UX, визуализация, алгоритм сканера. |
| [`docs/02-roadmap.md`](./docs/02-roadmap.md) | Исходный поэтапный план разработки. |
| [`docs/03-data-format.md`](./docs/03-data-format.md) | Контракт формата данных (JSON/CSV) — единый для Python и фронтенда. |
| [`docs/prototype-reference.jsx`](./docs/prototype-reference.jsx) | Референсный React+SVG прототип (НЕ запускается, только для сверки логики). |
| `frontend/` | Production-фронтенд: Vite + React 18 + TypeScript + Tailwind + Canvas. |
| `data-pipeline/` | Python-агрегатор: Binance Vision AggTrades → JSON с кластерами. |

---

## Технологический стек

### Frontend (`frontend/`)

- **Vite** + **React 18** + **TypeScript** (strict)
- **Tailwind CSS** (тема в стиле TradingView)
- **Canvas API** для рендера свечей и футпринта (60 FPS на 100k+ свечей)
- **lucide-react** — иконки
- **Zod** — валидация загружаемых данных
- **idb** — IndexedDB-обёртка для автосохранения POI и кэша файлов
- **Web Worker** для сканера (не блокирует UI)
- **Vitest** — unit-тесты

### Data pipeline (`data-pipeline/`)

- **Python 3.11+**
- **pandas** — агрегация тиков
- **requests** — скачивание Binance Vision
- **pydantic** — валидация выхода
- **pytest** — тесты

---

## Быстрый старт (после реализации MVP)

### Frontend

```bash
cd frontend
npm install
npm run dev
# открыть http://localhost:5173
```

### Data pipeline

```bash
cd data-pipeline
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
python -m smc_data BTCUSDT --start 2026-04-25 --days 5 --tick-size 5 -o ../frontend/public/data.json
```

После этого в открытом терминале нажать «Загрузить историю» (или drag&drop файла `data.json` в окно).

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

## Алгоритм сканера (4 правила, кратко)

Сигнал **LONG** на 5-минутной свече — все 4 условия одновременно:

1. `close > (high + low) / 2` — закрытие в верхней половине диапазона.
2. `total_delta > 0` — общий перевес покупок.
3. `close > vpoc_price` — закрытие выше уровня максимального объёма.
4. `delta_at_low < 0` — поглощение продаж на самом лое (агрессоры били вниз, но крупный лимитник впитал).

Сигнал **SHORT** — зеркальные условия. Подробности — в [`docs/01-spec.md` §5](./docs/01-spec.md#5-жёсткий-алгоритм-сканера-4-правила-входа).

---

## Принципы разработки

| Принцип | Реализация |
|---|---|
| **Надёжность** | TypeScript strict, Zod-валидация, unit-тесты на сканер и агрегатор. |
| **Удобство** | Hotkeys, undo, drag&drop, автосохранение разметки. |
| **Быстро** | Canvas с самого начала, виртуализация, Web Worker, IndexedDB-кэш. |
| **Информативно** | Расширенный отчёт сканера, детальный StatusBar, тултипы по кластерам. |

---

## Источники данных

- **Binance Vision** — `https://data.binance.vision/data/spot/daily/aggTrades/{SYMBOL}/{SYMBOL}-aggTrades-YYYY-MM-DD.zip` — бесплатно, без API-ключа.
- Fallback: Binance REST API `/api/v3/aggTrades`.

---

## Лицензия

Internal / TBD.
