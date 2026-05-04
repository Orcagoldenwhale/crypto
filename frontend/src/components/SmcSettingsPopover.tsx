/**
 * Минимальная панель настроек SMC-индикатора.
 *
 * Поля:
 *   1. lookback (int 2..50)              — окно для swing-points;
 *   2. equalityTolerancePct (% 0..5)     — допуск близости equal-highs/lows
 *      (хранится как доля 0..0.05, отображается как % 0..5);
 *   3. hideMitigatedFvg (bool)           — прятать ли отработанные FVG.
 *
 * Дизайн совместим с тулбоксом: тёмная панелька, мелкий ввод, без анимаций.
 * При закрытии (клик вне / Esc) сохраняем в localStorage через onChange + onClose.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { SmcOptions } from '@/engine/smc/types';

interface SmcSettingsPopoverProps {
  options: SmcOptions;
  onChange: (next: SmcOptions) => void;
  onClose: () => void;
  /** Координаты «якоря» — обычно правый верх кнопки-шестерёнки. */
  anchorX: number;
  anchorY: number;
}

export function SmcSettingsPopover({
  options,
  onChange,
  onClose,
  anchorX,
  anchorY,
}: SmcSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Esc + клик вне → закрыть. Используем capture-phase, чтобы поведение не
  // конфликтовало с обработчиками вложенных элементов.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const node = popoverRef.current;
      if (node && !node.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDocClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const setField = <K extends keyof SmcOptions>(
    key: K,
    value: SmcOptions[K],
  ) => {
    onChange({ ...options, [key]: value });
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 flex w-64 flex-col gap-3 rounded-md border border-tv-border bg-tv-panel/98 p-3 shadow-2xl backdrop-blur-sm"
      style={{ left: anchorX, top: anchorY }}
      role="dialog"
      aria-label="Настройки SMC"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-tv-text">
          Настройки SMC
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-tv-text-muted hover:text-tv-text"
          aria-label="Закрыть"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Field label="Lookback (свечи)" hint="окно swing-points с каждой стороны">
        <input
          type="number"
          min={2}
          max={50}
          step={1}
          value={options.lookback}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v)) setField('lookback', clamp(v, 2, 50));
          }}
          className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
        />
      </Field>

      <Field
        label="Допуск equal-highs/lows (%)"
        hint="близость двух swing-points как доля от цены"
      >
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={(options.equalityTolerancePct * 100).toFixed(2)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) {
              setField('equalityTolerancePct', clamp(v / 100, 0, 0.05));
            }
          }}
          className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-tv-text">
        <input
          type="checkbox"
          checked={options.hideMitigatedFvg}
          onChange={(e) => setField('hideMitigatedFvg', e.target.checked)}
          className="h-3.5 w-3.5 accent-tv-accent"
        />
        Прятать отработанные FVG
      </label>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-tv-text">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-tv-text-muted">{hint}</span>}
    </label>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
