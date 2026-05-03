import type { Candle5m, Candle15m, Candle1h, Timeframe } from '@/types';
import { APP_VERSION, buildTimeShort } from '@/version';

interface StatusBarProps {
  symbol: string;
  timeframe: Timeframe;
  candlesCount: number;
  zonesCount: number;
  signalsCount: number;
  /** Свеча под курсором — отображается в расширенной зоне статус-бара. */
  hoveredCandle: Candle5m | Candle15m | Candle1h | null;
}

export function StatusBar({
  symbol,
  timeframe,
  candlesCount,
  zonesCount,
  signalsCount,
  hoveredCandle,
}: StatusBarProps) {
  return (
    <div className="flex h-7 flex-shrink-0 items-center justify-between gap-2 border-t border-tv-border bg-tv-panel px-3 font-mono text-xs text-tv-text-dim">
      {/* Левая зона: контекст символа и количества */}
      <div className="flex flex-shrink-0 items-center gap-3">
        <Item label="Symbol" value={symbol} mono />
        <Divider />
        <Item label="TF" value={timeframe} mono />
        <Divider />
        <Item label="Candles" value={candlesCount.toLocaleString('ru-RU')} mono />
      </div>

      {/* Центральная зона: OHLCV под курсором.
          Если ничего не наведено — placeholder, чтобы строка не "прыгала" в высоте. */}
      <HoveredCandleStrip candle={hoveredCandle} />

      {/* Правая зона: счётчики и версия */}
      <div className="flex flex-shrink-0 items-center gap-3">
        <Item label="POI" value={String(zonesCount)} mono />
        <Divider />
        <Item label="Signals" value={String(signalsCount)} mono />
        <Divider />
        <span
          className="font-mono text-tv-text-muted"
          title={`Build time: ${buildTimeShort()}`}
        >
          v{APP_VERSION}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// OHLCV под курсором
// ============================================================================

interface HoveredCandleStripProps {
  candle: Candle5m | Candle15m | Candle1h | null;
}

function HoveredCandleStrip({ candle }: HoveredCandleStripProps) {
  if (!candle) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-3 overflow-hidden text-tv-text-muted/60">
        <span className="truncate text-[11px]">Наведите курсор на свечу</span>
      </div>
    );
  }

  const isUp = candle.close >= candle.open;
  const dir = isUp ? 'text-tv-up' : 'text-tv-down';
  const time = new Date(candle.timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Δ есть только у Candle5m (Candle15m не несёт кластеров)
  const hasDelta = 'delta' in candle && typeof candle.delta === 'number';

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5 overflow-hidden">
      <span className="text-tv-text-muted">{time}</span>
      <Divider />
      <Pair label="O" value={candle.open.toFixed(2)} dir={dir} />
      <Pair label="H" value={candle.high.toFixed(2)} dir={dir} />
      <Pair label="L" value={candle.low.toFixed(2)} dir={dir} />
      <Pair label="C" value={candle.close.toFixed(2)} dir={dir} />
      <Pair label="V" value={fmtVol(candle.volume)} dir="text-tv-text" />
      {hasDelta && (
        <Pair
          label="Δ"
          value={fmtSignedVol((candle as Candle5m).delta)}
          dir={(candle as Candle5m).delta > 0 ? 'text-tv-up' : (candle as Candle5m).delta < 0 ? 'text-tv-down' : 'text-tv-text'}
        />
      )}
    </div>
  );
}

interface PairProps {
  label: string;
  value: string;
  dir: string;
}

function Pair({ label, value, dir }: PairProps) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-tv-text-muted">{label}</span>
      <span className={dir}>{value}</span>
    </span>
  );
}

interface ItemProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Item({ label, value, mono = false }: ItemProps) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-tv-text-muted">{label}:</span>
      <span className={mono ? 'font-mono text-tv-text' : 'text-tv-text'}>
        {value}
      </span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px flex-shrink-0 bg-tv-border" />;
}

function fmtVol(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(2);
}

function fmtSignedVol(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${fmtVol(v)}`;
}
