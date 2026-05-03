# `smc-data` — Python data pipeline

Скачивает с **Binance Vision** агрегированные сделки (`aggTrades`) и собирает
их в 5-минутные свечи с **настоящими кластерами** (`bid × ask` на каждом ценовом
уровне). Выходной JSON загружается во фронтенд через drag & drop.

Это **источник правды** для боевого режима терминала — без зависимости от
интернета в браузере.

---

## Quick start

### 1. Установить (один раз)

```bash
cd data-pipeline
python3 -m venv .venv             # требуется Python 3.9+
source .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -e ".[dev]"           # установит сам пакет + dev-зависимости
```

### 2. Запустить выгрузку

```bash
smc-data BTCUSDT --days 5 --out btcusdt-5d.json
# или то же самое через модуль:
python -m smc_data BTCUSDT --days 5 --out btcusdt-5d.json
```

По умолчанию `--start` = сегодня минус `--days` (с учётом задержки публикации
архивов на Vision — обычно есть данные за вчера и старше).

Что произойдёт:

1. Для каждого дня скачивается `BTCUSDT-aggTrades-YYYY-MM-DD.zip` (~30–80 MB сжатый).
2. Распаковывается в DataFrame, кэшируется в parquet (`~/.smc-cache/...`).
3. Тики агрегируются в 5-минутные свечи + bid/ask на каждом ценовом уровне.
4. Pydantic-модель валидирует выход и сериализует в JSON.

### 3. Открыть JSON в терминале

В браузере: перетащить `btcusdt-5d.json` в окно. Готовый footprint с реальными
имбалансами и поглощениями появится мгновенно.

---

## Параметры CLI

```text
smc-data SYMBOL [--days N] [--start YYYY-MM-DD] [--out PATH] [--tick-size N]

  SYMBOL                      Тикер. Пока поддерживается BTCUSDT.
  --days N                    Сколько дней назад от --start. По умолчанию 5.
  --start YYYY-MM-DD          Самый ранний день (UTC). По умолчанию: today − days.
  --out PATH                  Куда писать JSON. По умолчанию: ./<symbol>-<days>d.json.
  --tick-size N               Шаг ценовых уровней. По умолчанию 5 (для BTC).
  --no-cache                  Игнорировать parquet-кэш и качать заново.
  --cache-dir PATH            Где держать кэш. По умолчанию ~/.smc-cache.
```

---

## Архитектура

```
data-pipeline/
├── pyproject.toml
├── requirements.txt           ← runtime-deps
├── requirements-dev.txt       ← +pytest +ruff
├── README.md                  ← вы здесь
├── src/smc_data/
│   ├── __init__.py
│   ├── __main__.py            ← `python -m smc_data ...`
│   ├── schema.py              ← Pydantic-модели (контракт с фронтом)
│   ├── download.py            ← скачивание ZIP + парсинг + parquet-кэш
│   ├── aggregate.py           ← главная функция: тики → 5m свечи
│   └── cli.py                 ← argparse, прогресс, ошибки
└── tests/
    ├── test_schema.py
    ├── test_aggregate.py
    └── fixtures/
        └── synthetic_ticks.csv  ← 50 синтетических тиков для unit-тестов
```

---

## Контракт с фронтом

JSON ОБЯЗАН соответствовать `frontend/src/types/index.ts::Dataset`. Любое
расхождение → Zod-валидатор на фронте отклоняет файл с понятной ошибкой.

```json
{
  "meta": {
    "symbol": "BTCUSDT",
    "exchange": "binance",
    "timeframe": "5m",
    "tick_size": 5,
    "from": "2026-04-26T00:00:00Z",
    "to": "2026-05-01T00:00:00Z",
    "candles_count": 1440,
    "generated_at": "2026-05-02T16:30:00Z",
    "source": "binance-vision-aggTrades",
    "version": 1
  },
  "candles": [
    {
      "timestamp": 1714089600000,
      "open": 65432.10, "high": 65500.00, "low": 65380.50, "close": 65461.00,
      "volume": 12.345, "delta": 1.234,
      "vpoc_price": 65430, "max_vol": 5.6,
      "delta_at_low": -0.8, "delta_at_high": 0.3,
      "clusters": [
        { "price": 65380, "bid": 0.5, "ask": 0.2, "vol": 0.7, "delta": -0.3 },
        ...
      ]
    },
    ...
  ]
}
```

См. также `docs/03-data-format.md` — формализованная схема данных.

---

## Тесты

```bash
pytest                # все unit-тесты на синтетике (без сети)
pytest --cov          # с покрытием
ruff check . && ruff format --check .   # линтер и формат
```

Сетевая часть (download.py) тестируется только вручную — её unit-тестируем
через мок-fetcher.

---

## Лицензия

MIT.
