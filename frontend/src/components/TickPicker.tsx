import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Grid3x3 } from 'lucide-react';
import {
  TICK_MULTIPLIER_VALUES,
  type TickMultiplier,
} from '@/engine/regroupClusters';
import type { TickPref } from '@/data/tickPreference';

interface TickPickerProps {
  /** Пользовательская настройка: 'auto' или фиксированный множитель. */
  pref: TickPref;
  /** Какой множитель РЕАЛЬНО применяется сейчас (для подписи в режиме «авто»). */
  effective: TickMultiplier;
  /** Сменить настройку. App мгновенно перерегруппирует кластеры. */
  onChange: (pref: TickPref) => void;
  /** Доступен только когда есть данные с кластерами (5m с >= 2 уровнями). */
  disabled?: boolean;
}

/**
 * Селектор множителя tick_size — определяет, насколько крупно
 * объединять ценовые ячейки в footprint.
 *
 * Доступные опции:
 *   - «авто» — рассчитывается по плотности кластеров текущего датасета
 *     (см. computeAutoMultiplier);
 *   - ручные ×1, ×2, ×5, ×10.
 *
 * Изменение pref не блокирует UI: regroupCandles работает за миллисекунды
 * на 1440 свечах, перерисовка идёт через стандартный реактивный цикл.
 */
export function TickPicker({
  pref,
  effective,
  onChange,
  disabled = false,
}: TickPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Подпись на триггере: в авто-режиме показываем итоговый множитель,
  // чтобы пользователь видел, как алгоритм укрупнил его сетку.
  const triggerLabel =
    pref === 'auto' ? `авто · ×${effective}` : `×${pref.manual}`;

  const handlePick = (next: TickPref) => {
    setOpen(false);
    onChange(next);
  };

  const isAuto = pref === 'auto';

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title="Размер ячейки footprint (tick × N)"
        className="flex items-center gap-1.5 rounded border border-tv-border bg-tv-panel/95 px-2 py-1 text-xs font-mono text-tv-text transition-colors hover:bg-tv-panel-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Grid3x3 className="h-3.5 w-3.5 text-tv-text-dim" />
        <span>{triggerLabel}</span>
        <ChevronDown
          className={`h-3 w-3 text-tv-text-dim transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-tv-border bg-tv-panel shadow-2xl">
          <button
            type="button"
            onClick={() => handlePick('auto')}
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
              isAuto
                ? 'bg-tv-accent/15 text-white'
                : 'text-tv-text hover:bg-tv-panel-hover'
            }`}
          >
            <span>авто</span>
            <span className="text-[10px] text-tv-text-dim">×{effective}</span>
          </button>
          <div className="h-px bg-tv-border" />
          {TICK_MULTIPLIER_VALUES.map((m) => {
            const active = !isAuto && pref.manual === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => handlePick({ manual: m })}
                className={`block w-full px-3 py-2 text-left text-xs font-mono transition-colors ${
                  active
                    ? 'bg-tv-accent/15 text-white'
                    : 'text-tv-text hover:bg-tv-panel-hover'
                }`}
              >
                ×{m}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
