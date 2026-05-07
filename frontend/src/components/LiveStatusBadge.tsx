import type { LiveStatus } from '@/types';

interface LiveStatusBadgeProps {
  status: LiveStatus;
}

/**
 * Маленький индикатор статуса live-стрима в шапке.
 *
 * Цвета и иконки:
 *   live          — зелёная точка (пульсация);
 *   gap-filling   — циан, текст «догон»;
 *   reconnecting  — жёлтая, мигающая;
 *   connecting    — серая;
 *   error         — красная;
 *   idle          — невидим (компонент возвращает null).
 */
export function LiveStatusBadge({ status }: LiveStatusBadgeProps) {
  if (status === 'idle') return null;

  const palette = STATUS_PALETTE[status];

  return (
    <div
      className="flex items-center gap-1.5 rounded border border-tv-border bg-tv-bg-deep px-2 py-1 font-mono text-[11px]"
      title={palette.title}
    >
      <span
        className={`h-2 w-2 rounded-full ${palette.dot} ${palette.pulse ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      <span className={palette.text}>{palette.label}</span>
    </div>
  );
}

interface PaletteItem {
  dot: string;
  text: string;
  label: string;
  pulse: boolean;
  title: string;
}

const STATUS_PALETTE: Record<Exclude<LiveStatus, 'idle'>, PaletteItem> = {
  connecting: {
    dot: 'bg-tv-text-muted',
    text: 'text-tv-text-muted',
    label: 'CONNECTING',
    pulse: true,
    title: 'Открываем WebSocket к Binance',
  },
  'gap-filling': {
    dot: 'bg-cyan-400',
    text: 'text-cyan-300',
    label: 'GAP-FILL',
    pulse: true,
    title: 'Догоняем пропущенные тики через REST',
  },
  live: {
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    label: 'LIVE',
    pulse: true,
    title: 'Поток сделок Binance в реальном времени',
  },
  reconnecting: {
    dot: 'bg-yellow-400',
    text: 'text-yellow-300',
    label: 'RECONNECT',
    pulse: true,
    title: 'WebSocket разорван, переподключаемся',
  },
  error: {
    dot: 'bg-red-500',
    text: 'text-red-400',
    label: 'ERROR',
    pulse: false,
    title: 'Не удаётся подключиться (см. консоль)',
  },
};
