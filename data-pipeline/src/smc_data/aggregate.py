"""Агрегация тиков → 5-минутные свечи с кластерной разбивкой.

Принципы:
1. **Сторона тика** определяется по флагу ``is_buyer_maker``:
   - True  → покупатель пассивен, продавец агрессивен → **taker SELL** (удар в bid).
   - False → продавец пассивен, покупатель агрессивен → **taker BUY**  (удар в ask).
2. **Ценовой бакет** = ``floor(price / tick_size) * tick_size``.
3. **5m-окно** = ``floor(timestamp / 300_000) * 300_000`` (UTC, кратно 5 минутам).
4. Внутри окна:
     - OHLC по price (open=первый, close=последний, high=max, low=min);
     - на каждом ценовом бакете считаем ``bid``, ``ask``, ``vol``, ``delta``;
     - VPOC = бакет с максимальным ``vol``;
     - ``delta_at_low`` / ``delta_at_high`` — дельта кластера на бакете low/high
       (0 если нет такого бакета).

Используется чистый pandas: один проход на DataFrame, никаких apply.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from .schema import Candle5m, Cluster, Dataset, DatasetMeta

UTC = timezone.utc

logger = logging.getLogger(__name__)

FIVE_MIN_MS = 5 * 60 * 1000


# ============================================================================
# Публичные функции
# ============================================================================


def aggregate_ticks(
    df: pd.DataFrame,
    *,
    symbol: str,
    tick_size: float,
    exchange: str = "binance",
    source: str = "binance-vision-aggTrades",
) -> Dataset:
    """Превращает DataFrame тиков в валидированный ``Dataset``.

    DataFrame должен содержать колонки:
        timestamp (int64, ms), price (float64), quantity (float64),
        is_buyer_maker (bool).
    """
    if df.empty:
        raise ValueError("пустой DataFrame — нет тиков для агрегации")
    _validate_input(df)

    # 1. Подготовка: окна, бакеты, bid/ask по тику.
    work = pd.DataFrame(
        {
            "timestamp": df["timestamp"].to_numpy(dtype=np.int64),
            "price": df["price"].to_numpy(dtype=np.float64),
            "qty": df["quantity"].to_numpy(dtype=np.float64),
            "is_maker": df["is_buyer_maker"].to_numpy(dtype=bool),
        }
    )
    work["window"] = (work["timestamp"] // FIVE_MIN_MS) * FIVE_MIN_MS
    work["bucket"] = (np.floor(work["price"] / tick_size) * tick_size).astype(np.float64)
    # is_maker = True ⇒ taker SELL ⇒ объём идёт в bid; иначе в ask.
    work["bid_q"] = np.where(work["is_maker"], work["qty"], 0.0)
    work["ask_q"] = np.where(work["is_maker"], 0.0, work["qty"])

    # 2. Кластеры: groupby (window, bucket).
    clusters_df = (
        work.groupby(["window", "bucket"], sort=True)
        .agg(bid=("bid_q", "sum"), ask=("ask_q", "sum"))
        .reset_index()
    )
    clusters_df["vol"] = clusters_df["bid"] + clusters_df["ask"]
    clusters_df["delta"] = clusters_df["ask"] - clusters_df["bid"]

    # 3. OHLC и общая дельта/объём по 5m-окну.
    # Открытие/закрытие — первая/последняя цена тика по timestamp в окне.
    work_sorted = work.sort_values("timestamp", kind="stable")
    ohlc = (
        work_sorted.groupby("window", sort=True)
        .agg(
            open=("price", "first"),
            high=("price", "max"),
            low=("price", "min"),
            close=("price", "last"),
            volume=("qty", "sum"),
            bid_total=("bid_q", "sum"),
            ask_total=("ask_q", "sum"),
        )
        .reset_index()
    )
    ohlc["delta"] = ohlc["ask_total"] - ohlc["bid_total"]
    ohlc["low_bucket"] = (np.floor(ohlc["low"] / tick_size) * tick_size).astype(np.float64)
    ohlc["high_bucket"] = (np.floor(ohlc["high"] / tick_size) * tick_size).astype(np.float64)

    # 4. VPOC и max_vol — кластер с максимальным vol в каждом окне.
    idx_max = clusters_df.groupby("window")["vol"].idxmax()
    vpoc = clusters_df.loc[idx_max, ["window", "bucket", "vol"]].rename(
        columns={"bucket": "vpoc_price", "vol": "max_vol"}
    )
    ohlc = ohlc.merge(vpoc, on="window", how="left")

    # 5. delta_at_low / delta_at_high — мерджим кластеры на нужный bucket.
    delta_at_low = clusters_df.merge(
        ohlc[["window", "low_bucket"]].rename(columns={"low_bucket": "bucket"}),
        on=["window", "bucket"],
        how="inner",
    )[["window", "delta"]].rename(columns={"delta": "delta_at_low"})
    delta_at_high = clusters_df.merge(
        ohlc[["window", "high_bucket"]].rename(columns={"high_bucket": "bucket"}),
        on=["window", "bucket"],
        how="inner",
    )[["window", "delta"]].rename(columns={"delta": "delta_at_high"})

    ohlc = ohlc.merge(delta_at_low, on="window", how="left").fillna({"delta_at_low": 0.0})
    ohlc = ohlc.merge(delta_at_high, on="window", how="left").fillna({"delta_at_high": 0.0})

    # 6. Сборка свечей. Группируем clusters_df по window для быстрого доступа.
    clusters_by_window: dict[int, pd.DataFrame] = dict(tuple(clusters_df.groupby("window")))

    candles: list[Candle5m] = []
    for row in ohlc.itertuples(index=False):
        window_clusters_df = clusters_by_window.get(row.window)
        if window_clusters_df is None or window_clusters_df.empty:
            # Не должно случиться — окно есть в OHLC ⇒ есть тики ⇒ есть кластеры.
            cluster_objs: list[Cluster] = []
        else:
            cluster_objs = [
                Cluster(
                    price=float(c.bucket),
                    bid=float(c.bid),
                    ask=float(c.ask),
                    vol=float(c.vol),
                    delta=float(c.delta),
                )
                for c in window_clusters_df.sort_values("bucket").itertuples(index=False)
            ]

        candles.append(
            Candle5m(
                timestamp=int(row.window),
                open=float(row.open),
                high=float(row.high),
                low=float(row.low),
                close=float(row.close),
                volume=float(row.volume),
                delta=float(row.delta),
                vpoc_price=float(row.vpoc_price),
                max_vol=float(row.max_vol),
                delta_at_low=float(row.delta_at_low),
                delta_at_high=float(row.delta_at_high),
                clusters=cluster_objs,
            )
        )

    # 7. Метаданные. Период [from, to) по UTC из первой/последней свечи.
    if not candles:
        raise ValueError("после агрегации не осталось свечей")
    first_ts = candles[0].timestamp
    last_ts = candles[-1].timestamp + FIVE_MIN_MS  # эксклюзивная правая граница
    meta = DatasetMeta(
        symbol=symbol.upper(),
        exchange=exchange,
        timeframe="5m",
        tick_size=tick_size,
        **{"from": _to_iso(first_ts)},
        to=_to_iso(last_ts),
        candles_count=len(candles),
        generated_at=_to_iso_now(),
        source=source,
    )

    return Dataset(meta=meta, candles=candles)


# ============================================================================
# Internals
# ============================================================================


def _validate_input(df: pd.DataFrame) -> None:
    required = {"timestamp", "price", "quantity", "is_buyer_maker"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"в DataFrame не хватает колонок: {missing}")
    if (df["price"] <= 0).any():
        raise ValueError("в данных есть price ≤ 0")
    if (df["quantity"] <= 0).any():
        raise ValueError("в данных есть quantity ≤ 0")


def _to_iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
