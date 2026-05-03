"""CLI: ``smc-data BTCUSDT --days 5 --out btc.json``."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from .aggregate import aggregate_ticks
from .download import DEFAULT_CACHE_DIR, fetch_day

UTC = timezone.utc
logger = logging.getLogger("smc_data")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="smc-data",
        description="Скачать aggTrades с Binance Vision и собрать в 5m кластерные свечи.",
    )
    p.add_argument("symbol", help="Тикер, напр. BTCUSDT")
    p.add_argument(
        "--days",
        type=int,
        default=5,
        help="Сколько дней назад от --start (включительно). По умолчанию 5.",
    )
    p.add_argument(
        "--start",
        type=_parse_date,
        default=None,
        help=(
            "Самый ПОЗДНИЙ день (UTC), формат YYYY-MM-DD. "
            "По умолчанию: вчера (Vision публикует с задержкой 1 день)."
        ),
    )
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Куда писать JSON. По умолчанию: ./<symbol>-<days>d.json в текущей директории.",
    )
    p.add_argument(
        "--tick-size",
        type=float,
        default=5.0,
        help="Шаг ценовых уровней. Для BTC по умолчанию 5.",
    )
    p.add_argument("--no-cache", action="store_true", help="Игнорировать parquet-кэш.")
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=DEFAULT_CACHE_DIR,
        help=f"Где держать кэш (по умолчанию {DEFAULT_CACHE_DIR}).",
    )
    p.add_argument("-v", "--verbose", action="store_true", help="Подробный лог.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(verbose=args.verbose)

    symbol = args.symbol.upper()
    end_day: date = args.start or (datetime.now(UTC).date() - timedelta(days=1))
    days = [end_day - timedelta(days=i) for i in range(args.days - 1, -1, -1)]

    out_path: Path = args.out or Path.cwd() / f"{symbol.lower()}-{args.days}d.json"

    logger.info(
        "запуск: symbol=%s, дней=%d, [%s … %s], tick_size=%g, out=%s",
        symbol,
        args.days,
        days[0],
        days[-1],
        args.tick_size,
        out_path,
    )

    try:
        # 1. Скачивание (или кэш) по дням.
        frames: list[pd.DataFrame] = []
        for day in days:
            logger.info("=== день %s ===", day)
            df = fetch_day(
                symbol,
                day,
                cache_dir=args.cache_dir,
                use_cache=not args.no_cache,
            )
            logger.info("  тиков: %d", len(df))
            frames.append(df)

        all_ticks = pd.concat(frames, ignore_index=True)
        logger.info("всего тиков за %d дн.: %d", len(days), len(all_ticks))

        # 2. Агрегация.
        logger.info("агрегация в 5m кластерные свечи…")
        dataset = aggregate_ticks(all_ticks, symbol=symbol, tick_size=args.tick_size)
        logger.info(
            "готово: %d свечей, период %s … %s",
            dataset.meta.candles_count,
            dataset.meta.from_,
            dataset.meta.to,
        )

        # 3. Запись.
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(dataset.to_json_bytes())
        size_mb = out_path.stat().st_size / 1024 / 1024
        print(f"✔ записано {len(dataset.candles)} свечей → {out_path} ({size_mb:.2f} MB)")
        return 0

    except FileNotFoundError as e:
        logger.error("%s", e)
        return 2
    except KeyboardInterrupt:
        logger.warning("прервано пользователем")
        return 130
    except Exception as e:
        logger.exception("ошибка: %s", e)
        return 1


# ============================================================================
# Helpers
# ============================================================================


def _parse_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"неверная дата '{s}', нужен формат YYYY-MM-DD") from e


def _setup_logging(*, verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s · %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
