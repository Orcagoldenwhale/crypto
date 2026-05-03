"""Тесты агрегации тиков → 5m кластерные свечи."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from smc_data.aggregate import FIVE_MIN_MS, aggregate_ticks


def _ticks(rows: list[tuple[int, float, float, bool]]) -> pd.DataFrame:
    """Удобный конструктор: список (ts_ms, price, qty, is_buyer_maker)."""
    return pd.DataFrame(rows, columns=["timestamp", "price", "quantity", "is_buyer_maker"])


def test_single_window_simple() -> None:
    """Один 5m бакет, два ценовых уровня, оба направления."""
    base_ts = 1_700_000_000_000  # выровняем
    base_ts = (base_ts // FIVE_MIN_MS) * FIVE_MIN_MS
    df = _ticks(
        [
            # is_buyer_maker=True ⇒ taker SELL ⇒ bid
            (base_ts + 100, 100.0, 1.0, True),
            (base_ts + 200, 100.0, 2.0, False),  # taker BUY ⇒ ask
            (base_ts + 300, 105.0, 4.0, False),  # taker BUY ⇒ ask
        ]
    )

    ds = aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)
    assert len(ds.candles) == 1
    c = ds.candles[0]

    assert c.timestamp == base_ts
    assert c.open == 100.0
    assert c.high == 105.0
    assert c.low == 100.0
    assert c.close == 105.0
    assert c.volume == pytest.approx(7.0)
    assert c.delta == pytest.approx(2.0 + 4.0 - 1.0)  # ask − bid

    # Кластеры: бакет 100 → bid=1, ask=2; бакет 105 → bid=0, ask=4.
    assert len(c.clusters) == 2
    cl_100 = c.clusters[0]
    assert cl_100.price == 100.0
    assert cl_100.bid == pytest.approx(1.0)
    assert cl_100.ask == pytest.approx(2.0)

    cl_105 = c.clusters[1]
    assert cl_105.price == 105.0
    assert cl_105.bid == pytest.approx(0.0)
    assert cl_105.ask == pytest.approx(4.0)

    # VPOC = бакет с max объёмом = 105 (объём 4.0)
    assert c.vpoc_price == 105.0
    assert c.max_vol == pytest.approx(4.0)

    # delta_at_low = бакет low (100) ⇒ ask−bid = 2−1 = 1
    assert c.delta_at_low == pytest.approx(1.0)
    # delta_at_high = бакет high (105) ⇒ 4−0 = 4
    assert c.delta_at_high == pytest.approx(4.0)


def test_two_windows_separate() -> None:
    """Тики попадают в два разных 5m окна."""
    base = 1_700_000_000_000
    base = (base // FIVE_MIN_MS) * FIVE_MIN_MS
    df = _ticks(
        [
            (base + 100, 100.0, 1.0, False),
            (base + FIVE_MIN_MS + 100, 110.0, 2.0, True),
        ]
    )

    ds = aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)
    assert len(ds.candles) == 2
    assert ds.candles[0].timestamp == base
    assert ds.candles[1].timestamp == base + FIVE_MIN_MS
    assert ds.candles[0].close == 100.0
    assert ds.candles[1].close == 110.0


def test_bucket_floor_alignment() -> None:
    """Цена 102.5 при tick_size=5 должна попасть в бакет 100."""
    base = 1_700_000_000_000
    base = (base // FIVE_MIN_MS) * FIVE_MIN_MS
    df = _ticks([(base + 1, 102.5, 1.0, False), (base + 2, 107.0, 1.0, False)])
    ds = aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)
    prices = [c.price for c in ds.candles[0].clusters]
    assert prices == [100.0, 105.0]


def test_meta_period_iso() -> None:
    """meta.from / meta.to берутся из первой/последней свечи (UTC, ISO-8601)."""
    base = 1_700_000_000_000
    base = (base // FIVE_MIN_MS) * FIVE_MIN_MS
    df = _ticks([(base, 100.0, 1.0, False), (base + 2 * FIVE_MIN_MS, 100.0, 1.0, False)])
    ds = aggregate_ticks(df, symbol="ethusdt", tick_size=1.0)
    assert ds.meta.symbol == "ETHUSDT"
    assert ds.meta.timeframe == "5m"
    assert ds.meta.tick_size == 1.0
    assert ds.meta.from_.endswith("Z")
    assert ds.meta.to.endswith("Z")
    assert ds.meta.candles_count == len(ds.candles)


def test_empty_input_raises() -> None:
    df = _ticks([])
    with pytest.raises(ValueError, match="пустой"):
        aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)


def test_negative_price_raises() -> None:
    df = _ticks([(1_700_000_000_000, -1.0, 1.0, False)])
    with pytest.raises(ValueError, match="price"):
        aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)


def test_missing_columns_raises() -> None:
    df = pd.DataFrame({"timestamp": [1], "price": [1.0]})  # нет qty / is_buyer_maker
    with pytest.raises(ValueError, match="не хватает колонок"):
        aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)


def test_invariants_volume_and_delta_sum_to_candle() -> None:
    """Сумма cluster.vol == candle.volume, sum cluster.delta == candle.delta."""
    rng = np.random.default_rng(42)
    base = 1_700_000_000_000
    base = (base // FIVE_MIN_MS) * FIVE_MIN_MS
    n = 500
    rows = []
    for _ in range(n):
        ts_off = int(rng.integers(0, FIVE_MIN_MS - 1))
        price = float(100.0 + rng.normal(0, 5))
        qty = float(abs(rng.normal(1.0, 0.5)) + 0.01)
        is_maker = bool(rng.random() < 0.5)
        rows.append((base + ts_off, max(price, 1.0), qty, is_maker))

    df = _ticks(rows).sort_values("timestamp").reset_index(drop=True)
    ds = aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)
    c = ds.candles[0]
    assert c.volume == pytest.approx(sum(cl.vol for cl in c.clusters), rel=1e-9)
    assert c.delta == pytest.approx(sum(cl.delta for cl in c.clusters), rel=1e-9, abs=1e-9)
    # max_vol — реально максимальный объём кластера.
    assert c.max_vol == pytest.approx(max(cl.vol for cl in c.clusters))


def test_serialisation_roundtrip() -> None:
    """Dataset → JSON → парс обратно → совпадает по существенному."""
    import json

    base = 1_700_000_000_000
    base = (base // FIVE_MIN_MS) * FIVE_MIN_MS
    df = _ticks([(base + 1, 100.0, 1.0, False), (base + 2, 105.0, 2.0, True)])
    ds = aggregate_ticks(df, symbol="BTCUSDT", tick_size=5.0)

    raw = ds.to_json_bytes()
    parsed = json.loads(raw)
    assert parsed["meta"]["symbol"] == "BTCUSDT"
    assert parsed["meta"]["timeframe"] == "5m"
    assert "from" in parsed["meta"]  # alias применился
    assert isinstance(parsed["candles"], list)
    assert parsed["candles"][0]["timestamp"] == base
