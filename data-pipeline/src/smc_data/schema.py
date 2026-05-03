"""Pydantic-схемы — единственный источник правды для контракта с фронтом.

Имена полей и типы должны 1:1 соответствовать `frontend/src/types/index.ts`
(интерфейсы Cluster, Candle5m, Dataset, DatasetMeta).

Любая правка здесь требует синхронной правки на фронте.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Допустимый дрейф между bid+ask и vol, ask-bid и delta — на случай float-округлений.
_TOLERANCE = 1e-6

# ============================================================================
# Cluster
# ============================================================================


class Cluster(BaseModel):
    """Один ценовой уровень внутри 5m свечи."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    price: Annotated[float, Field(ge=0, description="Нижняя граница ценового бакета")]
    bid: Annotated[float, Field(ge=0, description="Объём агрессивных продаж (taker SELL)")]
    ask: Annotated[float, Field(ge=0, description="Объём агрессивных покупок (taker BUY)")]
    vol: Annotated[float, Field(ge=0, description="bid + ask")]
    delta: float = Field(description="ask - bid")

    @model_validator(mode="after")
    def _check_invariants(self) -> Cluster:
        if abs(self.vol - (self.bid + self.ask)) > _TOLERANCE:
            raise ValueError(f"vol={self.vol} ≠ bid+ask={self.bid + self.ask}")
        if abs(self.delta - (self.ask - self.bid)) > _TOLERANCE:
            raise ValueError(f"delta={self.delta} ≠ ask−bid={self.ask - self.bid}")
        return self


# ============================================================================
# Candle5m
# ============================================================================


class Candle5m(BaseModel):
    """5-минутная свеча с полной кластерной разбивкой."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    timestamp: Annotated[int, Field(ge=0, description="Unix ms, кратно 5 * 60 * 1000")]
    open: Annotated[float, Field(ge=0)]
    high: Annotated[float, Field(ge=0)]
    low: Annotated[float, Field(ge=0)]
    close: Annotated[float, Field(ge=0)]

    volume: Annotated[float, Field(ge=0, description="sum(clusters[].vol)")]
    delta: float = Field(description="sum(clusters[].delta) = ask−bid по свече")

    vpoc_price: Annotated[float, Field(ge=0)]
    max_vol: Annotated[float, Field(ge=0)]
    delta_at_low: float
    delta_at_high: float

    clusters: list[Cluster]

    # ----- инварианты -----

    @model_validator(mode="after")
    def _check_timestamp_aligned(self) -> Candle5m:
        if self.timestamp % (5 * 60 * 1000) != 0:
            raise ValueError(f"timestamp={self.timestamp} не кратен 5m")
        return self

    @model_validator(mode="after")
    def _check_ohlc(self) -> Candle5m:
        # high >= max(open, close, low) и low <= min(open, close, high)
        if self.high < max(self.open, self.close, self.low):
            raise ValueError(f"high={self.high} ниже одного из OCL")
        if self.low > min(self.open, self.close, self.high):
            raise ValueError(f"low={self.low} выше одного из OCH")
        return self

    @model_validator(mode="after")
    def _check_clusters(self) -> Candle5m:
        if not self.clusters:
            return self  # пустая свеча допустима (нет торгов в окне)

        # Кластеры должны быть отсортированы по возрастанию price.
        prices = [c.price for c in self.clusters]
        if prices != sorted(prices):
            raise ValueError("clusters не отсортированы по price")
        if len(set(prices)) != len(prices):
            raise ValueError("дубликаты price в clusters")

        # Сумма объёмов и дельт.
        sum_vol = sum(c.vol for c in self.clusters)
        sum_delta = sum(c.delta for c in self.clusters)
        if abs(sum_vol - self.volume) > _TOLERANCE * max(1.0, sum_vol):
            raise ValueError(f"volume={self.volume} ≠ Σ cluster.vol={sum_vol}")
        if abs(sum_delta - self.delta) > _TOLERANCE * max(1.0, abs(sum_delta) + 1):
            raise ValueError(f"delta={self.delta} ≠ Σ cluster.delta={sum_delta}")

        # max_vol и vpoc_price — это кластер с максимальным объёмом.
        max_cluster = max(self.clusters, key=lambda c: c.vol)
        if abs(max_cluster.vol - self.max_vol) > _TOLERANCE:
            raise ValueError(f"max_vol={self.max_vol} ≠ vol VPOC={max_cluster.vol}")
        if abs(max_cluster.price - self.vpoc_price) > _TOLERANCE:
            raise ValueError(f"vpoc_price={self.vpoc_price} ≠ price VPOC={max_cluster.price}")

        return self


# ============================================================================
# Meta
# ============================================================================


class DatasetMeta(BaseModel):
    """Метаданные датасета. ISO-8601 строки в полях времени."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    symbol: Annotated[str, Field(min_length=1, pattern=r"^[A-Z0-9]+$")]
    exchange: Annotated[str, Field(min_length=1)] = "binance"
    timeframe: Literal["5m"] = "5m"
    tick_size: Annotated[float, Field(gt=0)]
    # Время в ISO-8601, например '2026-04-26T00:00:00Z'.
    from_: Annotated[str, Field(alias="from", min_length=1)]
    to: Annotated[str, Field(min_length=1)]
    candles_count: Annotated[int, Field(ge=0)]
    generated_at: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field(min_length=1)] = "binance-vision-aggTrades"
    version: int = 1


# ============================================================================
# Dataset
# ============================================================================


class Dataset(BaseModel):
    """Полный датасет: meta + свечи."""

    model_config = ConfigDict(extra="forbid")

    meta: DatasetMeta
    candles: list[Candle5m]

    @model_validator(mode="after")
    def _check_count(self) -> Dataset:
        if self.meta.candles_count != len(self.candles):
            raise ValueError(
                f"meta.candles_count={self.meta.candles_count} ≠ len(candles)={len(self.candles)}"
            )
        return self

    @model_validator(mode="after")
    def _check_sorted_unique(self) -> Dataset:
        ts = [c.timestamp for c in self.candles]
        if ts != sorted(ts):
            raise ValueError("candles не отсортированы по timestamp")
        if len(set(ts)) != len(ts):
            raise ValueError("дубликаты timestamp в candles")
        return self

    def to_json_bytes(self) -> bytes:
        """Сериализует в JSON-байты с алиасом from_ → from."""
        return self.model_dump_json(by_alias=True, indent=2).encode("utf-8")
