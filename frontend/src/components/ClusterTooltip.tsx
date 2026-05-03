/**
 * Плавающий тултип для ячейки кластера в footprint-режиме.
 *
 * Появляется при наведении на ячейку и показывает:
 *   - уровень цены (start уровня кластера)
 *   - bid (taker SELL) и ask (taker BUY) с подсветкой имбаланса 2×
 *   - vol (общий объём уровня)
 *   - delta (ask − bid) с цветом
 *   - timestamp родительской свечи
 *
 * Позиционируется ОТНОСИТЕЛЬНО viewport (clientX/clientY), а не canvas,
 * поэтому никогда не перекрывается canvas-объектами и стабильно
 * лежит выше всего, кроме модальных окон.
 *
 * При выходе за правую/нижнюю границу — flip к курсору с обратной стороны,
 * чтобы тултип всегда оставался на экране.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { Cluster } from '@/types';

const IMBALANCE_RATIO = 2;
const OFFSET_PX = 14;

interface Props {
  cluster: Cluster;
  /** Timestamp родительской свечи — для подписи времени. */
  candleTimestamp: number;
  /** Координаты курсора в viewport (window). */
  clientX: number;
  clientY: number;
}

export function ClusterTooltip({ cluster, candleTimestamp, clientX, clientY }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: clientX + OFFSET_PX,
    top: clientY + OFFSET_PX,
  });

  // После того как элемент отрендерился, замеряем его реальный размер
  // и flip-аем, если он вылез за границу окна.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = clientX + OFFSET_PX;
    let top = clientY + OFFSET_PX;
    if (left + rect.width > vw - 8) left = clientX - OFFSET_PX - rect.width;
    if (top + rect.height > vh - 8) top = clientY - OFFSET_PX - rect.height;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [clientX, clientY]);

  const bidImb = cluster.bid > cluster.ask * IMBALANCE_RATIO;
  const askImb = cluster.ask > cluster.bid * IMBALANCE_RATIO;
  const deltaPositive = cluster.delta > 0;
  const deltaNegative = cluster.delta < 0;

  const time = new Date(candleTimestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 rounded-md border border-tv-border bg-tv-panel/98 px-3 py-2 font-mono text-[11px] text-tv-text shadow-2xl backdrop-blur-sm"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="mb-1 flex items-center gap-2 border-b border-tv-border pb-1">
        <span className="text-[10px] uppercase tracking-wider text-tv-text-muted">
          Cluster
        </span>
        <span className="font-bold text-tv-text">{cluster.price.toFixed(2)}</span>
        <span className="text-tv-text-muted">·</span>
        <span className="text-tv-text-dim">{time}</span>
      </div>
      <div className="space-y-0.5">
        <Row
          label="bid"
          value={fmt(cluster.bid)}
          color={bidImb ? 'imbBid' : 'normal'}
          extra={bidImb ? '⚡ imb 2×' : undefined}
        />
        <Row
          label="ask"
          value={fmt(cluster.ask)}
          color={askImb ? 'imbAsk' : 'normal'}
          extra={askImb ? '⚡ imb 2×' : undefined}
        />
        <Row label="vol" value={fmt(cluster.vol)} color="normal" />
        <Row
          label="delta"
          value={`${deltaPositive ? '+' : ''}${fmt(cluster.delta)}`}
          color={deltaPositive ? 'up' : deltaNegative ? 'down' : 'normal'}
        />
      </div>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  color: 'normal' | 'up' | 'down' | 'imbBid' | 'imbAsk';
  /** `exactOptionalPropertyTypes`: используем явный union, чтобы можно было
   *   передавать undefined в условном бэйдже без жалоб TS. */
  extra?: string | undefined;
}

function Row({ label, value, color, extra }: RowProps) {
  const cls = {
    normal: 'text-tv-text',
    up: 'text-tv-up font-bold',
    down: 'text-tv-down font-bold',
    imbBid: 'text-tv-down font-bold',
    imbAsk: 'text-tv-up font-bold',
  }[color];
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-tv-text-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={cls}>{value}</span>
        {extra && <span className="text-[9px] text-amber-400">{extra}</span>}
      </span>
    </div>
  );
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(2)}k`;
  return v.toFixed(2);
}
