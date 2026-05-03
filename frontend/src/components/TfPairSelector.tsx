import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { TF_PAIR_OPTIONS } from '@/data/tfPairs';
import type { TfPairId } from '@/types';

interface TfPairSelectorProps {
  value: TfPairId;
  onChange: (id: TfPairId) => void;
  disabled?: boolean;
}

/**
 * Выбор комбинации «старший → младший» таймфрейм.
 */
export function TfPairSelector({ value, onChange, disabled = false }: TfPairSelectorProps) {
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

  const cur = TF_PAIR_OPTIONS.find((o) => o.id === value) ?? TF_PAIR_OPTIONS[0]!;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={cur.hint}
        className="flex max-w-[200px] items-center gap-1 rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-left text-[11px] text-tv-text transition-colors hover:bg-tv-panel-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate font-mono">{cur.label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 text-tv-text-dim ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-md border border-tv-border bg-tv-panel shadow-2xl">
          {TF_PAIR_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setOpen(false);
                if (o.id !== value) onChange(o.id);
              }}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${
                o.id === value
                  ? 'bg-tv-accent/15 text-white'
                  : 'text-tv-text hover:bg-tv-panel-hover'
              }`}
            >
              <span className="font-mono text-xs">{o.label}</span>
              <span className="text-[10px] text-tv-text-dim">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
