import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SYMBOLS, type SymbolInfo } from '@/data/symbols';

interface SymbolPickerProps {
  /** Текущий выбранный символ (id, например 'BTCUSDT'). */
  value: string;
  /** Сменить символ. App перезагрузит датасет и сбросит зоны. */
  onChange: (id: string) => void;
  /** Disabled во время загрузки — иначе можно словить race condition. */
  disabled?: boolean;
}

/**
 * Dropdown выбора инструмента (BTC / ETH / SOL).
 *
 * Поведение:
 *   - закрывается по клику вне, по Esc и при выборе элемента;
 *   - текущий выбор подсвечен;
 *   - при disabled (идёт загрузка) клик по триггеру игнорируется,
 *     чтобы пользователь не запустил две загрузки параллельно.
 */
export function SymbolPicker({ value, onChange, disabled = false }: SymbolPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const current = SYMBOLS.find((s) => s.id === value) ?? SYMBOLS[0]!;

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

  const handlePick = (s: SymbolInfo) => {
    setOpen(false);
    if (s.id !== value) onChange(s.id);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={`${current.long} (${current.id})`}
        className="flex items-center gap-1.5 rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs font-mono font-bold text-tv-text transition-colors hover:bg-tv-panel-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="text-white">{current.short}</span>
        <span className="text-tv-text-dim">/USDT</span>
        <ChevronDown className={`h-3 w-3 text-tv-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-tv-border bg-tv-panel shadow-2xl">
          {SYMBOLS.map((s) => {
            const active = s.id === value;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => handlePick(s)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? 'bg-tv-accent/15 text-white'
                    : 'text-tv-text hover:bg-tv-panel-hover'
                }`}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono font-bold">{s.short}</span>
                  <span className="text-tv-text-dim">/USDT</span>
                </span>
                <span className="text-[10px] text-tv-text-dim">{s.long}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
