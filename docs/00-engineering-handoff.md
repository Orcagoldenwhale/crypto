# Engineering handoff — SMC Footprint Backtester

Документ для техники и команды, продолжающей разработку после смены среды или онбординга новых людей. **Не дублирует** полную продуктовую спецификацию — указывает, где «истина» и как воспроизвести сборку, тесты и процесс.

**Версия фронтенда на момент составления:** см. поле `version` в [`../frontend/package.json`](../frontend/package.json) (при создании файла: `1.17.13`).  
**Python-пакет:** `smc-data` — [`../data-pipeline/pyproject.toml`](../data-pipeline/pyproject.toml).

---

## 1. Что это за проект (в двух предложениях)

Полуавтоматический терминал: **SMC на старшем ТФ** + **footprint (кластеры bid/ask) на младшем**. История и кластеры — из **Binance Vision aggTrades** (pipeline) или из предсобранных JSON; в браузере — загрузка, разметка зон, сканер сигналов, Canvas-рендер. Подробности — в спеке и плане (раздел 2).

---

## 2. Источники правды (читать в этом порядке)

| Документ | Назначение |
|----------|------------|
| [`../PLAN.md`](../PLAN.md) | Живой план: этапы, чекбоксы, прогресс. |
| [`01-spec.md`](01-spec.md) | Продуктовая спека v3 (workflow, UI, сканер). |
| [`02-roadmap.md`](02-roadmap.md) | Исходная поэтапная дорожная карта. |
| [`03-data-format.md`](03-data-format.md) | Контракт JSON/данных между Python и фронтом. |
| [`04-live-mode.md`](04-live-mode.md) | Live-режим: WS aggTrade, gap fill, тесты live-слоя. |
| [`../README.md`](../README.md) | Быстрый старт, стек, навигация по репо. |

Прототип-референс (не прод): [`prototype-reference.jsx`](prototype-reference.jsx).

---

## 3. Структура репозитория

- **`frontend/`** — Vite + React + TypeScript (strict), Tailwind, Canvas, Vitest, Zod, IndexedDB (idb), Web Worker для сканера.
- **`data-pipeline/`** — пакет `smc-data`: скачивание Binance Vision, агрегация в 5m свечи с кластерами, pydantic, pytest, ruff.

Корень репозитория — **монорепо без единого workspace `package.json`**; команды запускаются **из соответствующей папки**.

---

## 4. Локальная среда и команды

### 4.1 Frontend

Требования: **Node.js** (LTS, совместимый с зависимостями в `frontend/package.json`).

```bash
cd frontend
npm install
npm run dev
```

- Дев-сервер: **http://localhost:5173** (скрипт `predev` освобождает порт 5173).
- Сборка: `npm run build` (tsc + vite build).
- Превью прод-сборки: `npm run preview`.

### 4.2 Data pipeline (Python)

В `data-pipeline/README.md`: Python **3.9+** для venv; в `PLAN.md` фигурирует **3.11+** — для команды разумно зафиксировать одну версию (например **3.11** или **3.12**).

```bash
cd data-pipeline
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest
smc-data BTCUSDT --days 5 --out btcusdt-5d.json
```

Dev-зависимости: `pytest`, `pytest-cov`, `ruff` — см. `[project.optional-dependencies] dev` в `data-pipeline/pyproject.toml`.

---

## 5. Как велась разработка (рекомендуемый процесс для продолжения)

Исторически ориентир был такой (можно формализовать в Git / issue-трекере):

1. **Задача / этап** — отразить в [`../PLAN.md`](../PLAN.md) (статус `[ ]` / `[~]` / `[x]`).
2. **Поведение продукта** — сверка с [`01-spec.md`](01-spec.md); при изменении контракта данных — [`03-data-format.md`](03-data-format.md).
3. **Реализация** — минимальный дифф, без несвязанного рефакторинга.
4. **Тесты** — Vitest для фронта; pytest для pipeline; для live-слоя — см. раздел «Тестовое покрытие» в [`04-live-mode.md`](04-live-mode.md).
5. **Перед merge / релизом** — см. раздел 6 (чеклист).

Формальный Scrum в репозитории не зафиксирован; команда может выбрать issues + короткие итерации поверх этого документа.

---

## 6. Тесты, линтеры, типы

### 6.1 Frontend (`frontend/`)

| Команда | Назначение |
|---------|------------|
| `npm run test` | Vitest (watch). |
| `npm run test:run` | Vitest один прогон (CI). |
| `npm run test:ui` | Vitest UI. |
| `npm run lint` | ESLint (`frontend/eslint.config.js`). |
| `npm run typecheck` | `tsc -b --noEmit`. |

**Рекомендуемый минимум перед слиянием:** `npm run test:run` + `npm run lint` + `npm run typecheck`.

### 6.2 Python (`data-pipeline/`)

| Команда | Назначение |
|---------|------------|
| `pytest` | Тесты (`tests/`, конфиг в `pyproject.toml`). |
| `ruff check .` | Линт (настройки в `[tool.ruff]`). |
| `ruff format .` | Форматирование. |

В `PLAN.md` упоминаются ruff и black; **фактическая настройка в репо** — **ruff** в `data-pipeline/pyproject.toml`.

---

## 7. Принципы качества (зафиксированные в проекте)

Из [`../PLAN.md`](../PLAN.md) и [`../README.md`](../README.md):

- **TypeScript strict**, валидация входящих датасетов через **Zod** (`frontend/src/data/datasetSchema.ts` и тесты рядом).
- **Разделение слоёв:** загрузка данных / агрегация / движок SMC / сканер / UI.
- **Производительность:** Canvas, `requestAnimationFrame`, тяжёлый сканер в **Web Worker** где применимо.
- **Персистентность:** IndexedDB для POI и кэшей (см. `frontend/src/data/storage.ts` и live-док).

---

## 8. Данные и внешние сервисы

- **Binance Vision** — дневные архивы aggTrades (история с кластерами для footprint). Задержка публикации «сегодняшнего» дня — норма; см. `data-pipeline/README.md`.
- **Binance REST / WebSocket** — fallback и live-потоки в зависимости от фичи (см. `frontend/src/data/binanceLoader.ts`, [`04-live-mode.md`](04-live-mode.md)).
- **Ключи API** для публичных market-данных не обязательны; при приватных эндпоинтах — env и без коммита секретов.

---

## 9. Известные ограничения и долг

Кратко (детали в `04-live-mode.md` и `PLAN.md`):

- Live: часть UX (pre-signal на незакрытой свече, multi-symbol, авто-старт live) может быть в статусе **TODO / отложено** — см. раздел «Отложено» в [`04-live-mode.md`](04-live-mode.md).
- SMC на очень длинной истории: возможна оптимизация incremental SMC (описано как отложенная задача в том же документе).

---

## 10. Чеклист для нового разработчика (день 1)

- [ ] Прочитать этот файл и [`../PLAN.md`](../PLAN.md).
- [ ] Поднять `frontend`: `npm install` → `npm run dev`.
- [ ] Прогнать `npm run test:run`, `npm run lint`, `npm run typecheck`.
- [ ] Поднять `data-pipeline`: venv → `pip install -e ".[dev]"` → `pytest`.
- [ ] Сгенерировать небольшой JSON и открыть в UI (drag & drop), см. `data-pipeline/README.md`.

---

## 11. Шаблон контактов и доступов (заполнить вручную)

- Репозиторий:  
- Ветка по умолчанию / политика PR:  
- CI (если есть):  
- Хостинг / домен:  
- Ответственный за продукт / техлид:  

---

## История документа

| Дата | Изменение |
|------|-----------|
| 2026-05-11 | Первоначальная версия handoff при передаче команды / смене среды разработки. |
