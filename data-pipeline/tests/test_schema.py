"""Тесты Pydantic-схем — что инварианты ловятся."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from smc_data.schema import Candle5m, Cluster, Dataset, DatasetMeta

# ---------- Cluster ----------


def test_cluster_invariants_ok() -> None:
    c = Cluster(price=100.0, bid=2.0, ask=3.0, vol=5.0, delta=1.0)
    assert c.vol == 5.0


def test_cluster_vol_mismatch() -> None:
    with pytest.raises(ValidationError):
        Cluster(price=100.0, bid=2.0, ask=3.0, vol=99.0, delta=1.0)


def test_cluster_delta_mismatch() -> None:
    with pytest.raises(ValidationError):
        Cluster(price=100.0, bid=2.0, ask=3.0, vol=5.0, delta=99.0)


def test_cluster_negative_bid() -> None:
    with pytest.raises(ValidationError):
        Cluster(price=100.0, bid=-1.0, ask=3.0, vol=2.0, delta=4.0)


# ---------- Candle5m ----------


def _good_candle(timestamp: int = 1_700_000_000_000) -> Candle5m:
    # Округлим на 5m
    timestamp = (timestamp // (5 * 60 * 1000)) * (5 * 60 * 1000)
    clusters = [
        Cluster(price=100.0, bid=1.0, ask=2.0, vol=3.0, delta=1.0),
        Cluster(price=105.0, bid=4.0, ask=6.0, vol=10.0, delta=2.0),
    ]
    return Candle5m(
        timestamp=timestamp,
        open=101.0,
        high=106.0,
        low=99.0,
        close=104.0,
        volume=13.0,
        delta=3.0,
        vpoc_price=105.0,
        max_vol=10.0,
        delta_at_low=0.0,
        delta_at_high=0.0,
        clusters=clusters,
    )


def test_candle_ok() -> None:
    c = _good_candle()
    assert c.volume == 13.0


def test_candle_timestamp_unaligned() -> None:
    with pytest.raises(ValidationError, match="не кратен 5m"):
        Candle5m(
            timestamp=1_700_000_000_001,  # +1 ms
            open=100.0,
            high=100.0,
            low=100.0,
            close=100.0,
            volume=0.0,
            delta=0.0,
            vpoc_price=0.0,
            max_vol=0.0,
            delta_at_low=0.0,
            delta_at_high=0.0,
            clusters=[],
        )


def test_candle_high_below_close() -> None:
    with pytest.raises(ValidationError, match="high"):
        Candle5m(
            timestamp=0,
            open=100.0,
            high=99.0,
            low=98.0,
            close=100.0,  # close > high — невозможно
            volume=0.0,
            delta=0.0,
            vpoc_price=0.0,
            max_vol=0.0,
            delta_at_low=0.0,
            delta_at_high=0.0,
            clusters=[],
        )


def test_candle_volume_mismatch() -> None:
    c = _good_candle()
    bad = c.model_dump()
    bad["volume"] = 99.0
    with pytest.raises(ValidationError, match="volume"):
        Candle5m.model_validate(bad)


def test_candle_clusters_unsorted() -> None:
    c = _good_candle()
    bad = c.model_dump()
    bad["clusters"] = list(reversed(bad["clusters"]))
    with pytest.raises(ValidationError, match="не отсортированы"):
        Candle5m.model_validate(bad)


def test_candle_vpoc_mismatch() -> None:
    c = _good_candle()
    bad = c.model_dump()
    bad["vpoc_price"] = 100.0  # не совпадает с реальным VPOC=105
    with pytest.raises(ValidationError, match="vpoc_price"):
        Candle5m.model_validate(bad)


# ---------- Dataset / Meta ----------


def test_dataset_serialises_with_alias() -> None:
    candles = [_good_candle(1_700_000_000_000), _good_candle(1_700_000_300_000)]
    meta = DatasetMeta(
        symbol="BTCUSDT",
        tick_size=5.0,
        **{"from": "2026-04-26T00:00:00Z"},
        to="2026-05-01T00:00:00Z",
        candles_count=len(candles),
        generated_at="2026-05-02T16:30:00Z",
    )
    ds = Dataset(meta=meta, candles=candles)

    raw = ds.to_json_bytes()
    parsed = json.loads(raw)
    assert parsed["meta"]["from"] == "2026-04-26T00:00:00Z"
    assert "from_" not in parsed["meta"]
    assert parsed["meta"]["candles_count"] == 2
    assert len(parsed["candles"]) == 2


def test_dataset_count_mismatch() -> None:
    candles = [_good_candle(1_700_000_000_000)]
    meta = DatasetMeta(
        symbol="BTCUSDT",
        tick_size=5.0,
        **{"from": "2026-04-26T00:00:00Z"},
        to="2026-05-01T00:00:00Z",
        candles_count=99,  # не совпадает с реальным
        generated_at="2026-05-02T16:30:00Z",
    )
    with pytest.raises(ValidationError, match="candles_count"):
        Dataset(meta=meta, candles=candles)


def test_dataset_unsorted_candles() -> None:
    c1 = _good_candle(1_700_000_300_000)
    c2 = _good_candle(1_700_000_000_000)  # раньше c1
    meta = DatasetMeta(
        symbol="BTCUSDT",
        tick_size=5.0,
        **{"from": "2026-04-26T00:00:00Z"},
        to="2026-05-01T00:00:00Z",
        candles_count=2,
        generated_at="2026-05-02T16:30:00Z",
    )
    with pytest.raises(ValidationError, match="отсортированы"):
        Dataset(meta=meta, candles=[c1, c2])
