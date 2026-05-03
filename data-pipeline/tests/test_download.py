"""Тесты ZIP-парсера. Сетевую часть не дёргаем — только парсинг локального ZIP."""

from __future__ import annotations

import io
import zipfile

from smc_data.download import _parse_zip


def _make_zip(csv_text: str, name: str = "BTCUSDT-aggTrades-2026-04-26.csv") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(name, csv_text)
    return buf.getvalue()


def test_parse_zip_no_header_ms() -> None:
    """Старый формат: без заголовка, timestamp в ms."""
    csv = (
        # agg_id, price, quantity, first_id, last_id, timestamp_ms, is_buyer_maker, is_best
        "1,100.5,0.5,10,11,1700000000000,True,True\n"
        "2,101.0,0.3,12,13,1700000000500,False,True\n"
    )
    df = _parse_zip(_make_zip(csv))

    assert list(df.columns) == ["timestamp", "price", "quantity", "is_buyer_maker"]
    assert len(df) == 2
    assert df["timestamp"].iloc[0] == 1_700_000_000_000
    assert df["price"].iloc[0] == 100.5
    assert df["is_buyer_maker"].iloc[0] is True or df["is_buyer_maker"].iloc[0] == True  # noqa: E712


def test_parse_zip_microseconds_autoconvert() -> None:
    """Новый формат: timestamp в μs ⇒ автоматически делим на 1000."""
    micro = 1_700_000_000_000 * 1000  # = 1.7e18, явно > 1e13 ⇒ μs
    csv = (
        f"1,100.5,0.5,10,11,{micro},True,True\n"
        f"2,101.0,0.3,12,13,{micro + 500_000},False,True\n"
    )
    df = _parse_zip(_make_zip(csv))
    assert df["timestamp"].iloc[0] == 1_700_000_000_000
    assert df["timestamp"].iloc[1] == 1_700_000_000_500
