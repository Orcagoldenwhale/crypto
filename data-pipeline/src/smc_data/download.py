"""Скачивание архивов aggTrades с Binance Vision и парсинг в DataFrame.

Источник: https://data.binance.vision/data/spot/daily/aggTrades/<SYMBOL>/<SYMBOL>-aggTrades-YYYY-MM-DD.zip
Формат внутри ZIP: один CSV без заголовка, колонки:
    aggregate_tradeId, price, quantity, first_tradeId, last_tradeId,
    timestamp, was_the_buyer_the_maker, was_the_trade_the_best_price_match

ВАЖНО: timestamp может приходить в **миллисекундах** (старые архивы) или
**микросекундах** (свежие, ≥ 2025). Мы это автоопределяем по величине.
"""

from __future__ import annotations

import io
import logging
import time
import zipfile
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
import requests

logger = logging.getLogger(__name__)

# ============================================================================
# Константы
# ============================================================================

BASE_URL = "https://data.binance.vision/data/spot/daily/aggTrades"
DEFAULT_CACHE_DIR = Path.home() / ".smc-cache"

# Колонки CSV в архивах aggTrades.
_AGG_TRADES_COLS = [
    "agg_id",
    "price",
    "quantity",
    "first_id",
    "last_id",
    "timestamp",
    "is_buyer_maker",
    "is_best_match",
]

# HTTP-ретраи: на каких кодах повторяем.
_RETRIABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}


# ============================================================================
# Публичные функции
# ============================================================================


def fetch_day(
    symbol: str,
    day: date,
    *,
    cache_dir: Path = DEFAULT_CACHE_DIR,
    use_cache: bool = True,
    timeout: float = 30.0,
    max_retries: int = 3,
) -> pd.DataFrame:
    """Скачать (или взять из кэша) тики за один день.

    Возвращает DataFrame с колонками:
        timestamp (int64, ms), price (float64), quantity (float64), is_buyer_maker (bool)

    Парquet-кэш складывается в ``<cache_dir>/<SYMBOL>/<YYYY-MM-DD>.parquet``.
    """
    symbol = symbol.upper()
    cache_path = _cache_path(symbol, day, cache_dir)

    if use_cache and cache_path.exists():
        logger.info("cache hit: %s", cache_path)
        return pd.read_parquet(cache_path)

    url = _archive_url(symbol, day)
    logger.info("fetching %s", url)
    raw = _http_get_with_retry(url, timeout=timeout, max_retries=max_retries)
    df = _parse_zip(raw)

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(cache_path, index=False)
    logger.info("cached %d rows → %s", len(df), cache_path)

    return df


# ============================================================================
# Internals
# ============================================================================


def _archive_url(symbol: str, day: date) -> str:
    return f"{BASE_URL}/{symbol}/{symbol}-aggTrades-{day.isoformat()}.zip"


def _cache_path(symbol: str, day: date, cache_dir: Path) -> Path:
    return cache_dir / symbol / f"{day.isoformat()}.parquet"


def _http_get_with_retry(
    url: str,
    *,
    timeout: float,
    max_retries: int,
) -> bytes:
    """GET с экспоненциальным бэкоффом на retriable-кодах и сетевых ошибках."""
    delay = 1.0
    last_err: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            r = requests.get(url, timeout=timeout)
        except requests.RequestException as e:
            last_err = e
            logger.warning("attempt %d/%d: network error: %s", attempt, max_retries, e)
        else:
            if r.status_code == 200:
                return r.content
            if r.status_code == 404:
                raise FileNotFoundError(
                    f"архив не найден на Vision: {url} "
                    "(возможно, день ещё не опубликован — обычно есть данные за вчера и старше)"
                )
            if r.status_code not in _RETRIABLE_STATUS:
                r.raise_for_status()
            last_err = requests.HTTPError(f"HTTP {r.status_code} for {url}")
            logger.warning(
                "attempt %d/%d: HTTP %d, will retry", attempt, max_retries, r.status_code
            )

        if attempt < max_retries:
            time.sleep(delay)
            delay *= 2

    raise RuntimeError(f"не удалось скачать {url} после {max_retries} попыток: {last_err}")


def _parse_zip(raw: bytes) -> pd.DataFrame:
    """Распаковать ZIP и распарсить единственный CSV в DataFrame."""
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        names = zf.namelist()
        if len(names) != 1:
            raise ValueError(f"ожидался ровно 1 файл в ZIP, нашлось {len(names)}: {names}")
        with zf.open(names[0]) as f:
            return _parse_csv(f)


def _parse_csv(f: Any) -> pd.DataFrame:
    """Распарсить CSV aggTrades. Поддерживает обе схемы (с заголовком и без)."""
    # Сначала пробуем без заголовка с фиксированными именами.
    df = pd.read_csv(
        f,
        names=_AGG_TRADES_COLS,
        header=None,
        dtype={
            "agg_id": "int64",
            "price": "float64",
            "quantity": "float64",
            "first_id": "int64",
            "last_id": "int64",
            "timestamp": "int64",
            "is_buyer_maker": "bool",
            "is_best_match": "bool",
        },
    )

    # Свежие архивы Vision (≈ с 2025) содержат заголовок — первая строка
    # будет распаршена как мусор. Детектируем по первому agg_id, который
    # должен быть числом, но из-за header пришёл как 0 после coerce.
    if df.iloc[0]["price"] == 0.0 and df.iloc[0]["quantity"] == 0.0:
        # Первая строка — это header, перечитываем с header=0.
        f.seek(0) if hasattr(f, "seek") else None
        df = pd.read_csv(f, header=0)
        # Нормализуем колонки.
        df = df.rename(
            columns={
                "agg_trade_id": "agg_id",
                "first_trade_id": "first_id",
                "last_trade_id": "last_id",
                "transact_time": "timestamp",
            }
        )

    # Оставляем только нужное.
    df = df[["timestamp", "price", "quantity", "is_buyer_maker"]].copy()

    # Авто-детект единиц времени: если timestamp слишком велик —
    # это микросекунды (Vision начал писать с 2025), приводим к ms.
    sample_ts = int(df["timestamp"].iloc[0])
    if sample_ts > 10_000_000_000_000:  # > ~2286-11-20 в ms ⇒ это μs
        df["timestamp"] = df["timestamp"] // 1000
        logger.info("обнаружены микросекунды, привели к миллисекундам")

    df["timestamp"] = df["timestamp"].astype("int64")
    df["price"] = df["price"].astype("float64")
    df["quantity"] = df["quantity"].astype("float64")
    df["is_buyer_maker"] = df["is_buyer_maker"].astype(bool)

    return df.reset_index(drop=True)
