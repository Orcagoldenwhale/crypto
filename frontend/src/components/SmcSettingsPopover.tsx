/**
 * Модальная панель настроек SMC-индикатора (центр экрана).
 *
 * Поля:
 *   1. lookback (int 2..50)              — окно для swing-points;
 *   2. equalityTolerancePct (% 0..5)     — допуск близости equal-highs/lows
 *      (хранится как доля 0..0.05, отображается как % 0..5);
 *   3. hideMitigated.{layer} (4 чекбокса) — независимо прятать отработанные
 *      элементы для FVG, Liquidity, Structure, Order Blocks. Плюс кнопка
 *      «всё / ничего» для быстрого тоггла одной рукой.
 *
 * Раньше попап якорился у кнопки-шестерёнки и часто упирался в нижний край
 * экрана (особенно при коротких viewport). Теперь — центрированная модалка
 * с лёгким backdrop'ом: всегда видна целиком, ничего не обрезается.
 *
 * Закрытие: клик по backdrop / Esc / крестик. anchorX/anchorY оставлены в
 * пропсах для совместимости с Toolbox, но больше не используются.
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { SmcHideMitigated, SmcOptions } from '@/engine/smc/types';

interface SmcSettingsPopoverProps {
  options: SmcOptions;
  onChange: (next: SmcOptions) => void;
  onClose: () => void;
  /**
   * Открыть полное руководство. Если не передан — ссылка «Открыть инструкцию»
   * не отображается (Toolbox при этом всё равно показывает свою иконку «?»).
   */
  onOpenHelp?: () => void;
  /** @deprecated не используется (модалка центрируется во viewport). */
  anchorX?: number;
  /** @deprecated не используется (модалка центрируется во viewport). */
  anchorY?: number;
}

interface HideToggleSpec {
  key: keyof SmcHideMitigated;
  label: string;
  hint: string;
}

const HIDE_TOGGLES: readonly HideToggleSpec[] = [
  { key: 'fvg', label: 'FVG', hint: 'отработанные (цена возвращалась)' },
  { key: 'liquidity', label: 'Liquidity', hint: 'снятые (был sweep)' },
  { key: 'structure', label: 'Structure', hint: 'BOS/CHoCH с уже состоявшимся retest' },
  { key: 'orderBlocks', label: 'Order Blocks', hint: 'отработанные (цена касалась OB)' },
  { key: 'breakerBlocks', label: 'Breaker Blocks', hint: 'отработанные (цена касалась BB)' },
  { key: 'rejectionBlocks', label: 'Rejection Blocks', hint: 'отработанные (цена возвращалась в фитиль)' },
];

export function SmcSettingsPopover({
  options,
  onChange,
  onClose,
  onOpenHelp,
}: SmcSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // Esc → закрыть. Клик по backdrop ловим прямо на корневом элементе ниже
  // (см. handleBackdropClick) — так не нужно отслеживать глобальный mousedown
  // и нет риска ложных закрытий из-за вложенных порталов.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Закрытие по клику в backdrop. Реагируем ТОЛЬКО если клик пришёлся на
   * сам backdrop — иначе любой клик по контенту карточки закрывал бы её
   * (event.target всплывает наверх).
   */
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const setField = <K extends keyof SmcOptions>(
    key: K,
    value: SmcOptions[K],
  ) => {
    onChange({ ...options, [key]: value });
  };

  const setHideField = (key: keyof SmcHideMitigated, value: boolean) => {
    onChange({
      ...options,
      hideMitigated: { ...options.hideMitigated, [key]: value },
    });
  };

  const allChecked = HIDE_TOGGLES.every((t) => options.hideMitigated[t.key]);
  const someChecked = HIDE_TOGGLES.some((t) => options.hideMitigated[t.key]);
  const setAll = (v: boolean) => {
    onChange({
      ...options,
      hideMitigated: { fvg: v, liquidity: v, structure: v, orderBlocks: v },
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onMouseDown={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={popoverRef}
        className="flex max-h-[90vh] w-80 flex-col gap-3 overflow-y-auto rounded-md border border-tv-border bg-tv-panel/98 p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
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

      <Field
        label="FVG fill-порог (%)"
        hint="FVG валиден, пока не перекрыт более чем на X%"
      >
        <input
          type="number"
          min={0}
          max={100}
          step={5}
          value={options.fvgMaxFillPct}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v)) setField('fvgMaxFillPct', clamp(v, 0, 100));
          }}
          className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
        />
      </Field>

      <Field
        label="Мин. FVG (%)"
        hint="FVG меньше порога не отображаются"
      >
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={options.minFvgPct}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) setField('minFvgPct', clamp(v, 0, 5));
          }}
          className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
        />
      </Field>

      <div className="flex flex-col gap-1.5 border-t border-tv-border pt-2">
        <span className="text-[11px] font-medium text-tv-text">
          Order Blocks
        </span>

        <Field
          label="Выделение OB"
          hint="wicks — по фитилям, body — по телу, auto — авто-выбор"
        >
          <select
            value={options.obExtraction}
            onChange={(e) => setField('obExtraction', e.target.value as typeof options.obExtraction)}
            className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
          >
            <option value="wicks">По фитилям (wicks)</option>
            <option value="body">По телу (body)</option>
            <option value="auto">Авто (auto)</option>
          </select>
        </Field>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-tv-text">
          <input
            type="checkbox"
            checked={options.obUseMeanThreshold}
            onChange={(e) => setField('obUseMeanThreshold', e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-tv-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span>Учитывать Mean Threshold</span>
            <span className="text-[10px] text-tv-text-muted">
              OB живёт пока тело свечи не закрылось за 50% от тела OB
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-tv-text">
          <input
            type="checkbox"
            checked={options.obRequireAbsorption}
            onChange={(e) => setField('obRequireAbsorption', e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-tv-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span>Требовать поглощение телом</span>
            <span className="text-[10px] text-tv-text-muted">
              импульсная свеча должна закрыться за телом OB
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-tv-border pt-2">
        <span className="text-[11px] font-medium text-tv-text">
          Rejection Blocks
        </span>

        <Field
          label="Фитиль / тело (≥)"
          hint="свеча считается RB только если фитиль ≥ N × тело"
        >
          <input
            type="number"
            min={1}
            max={20}
            step={0.5}
            value={options.rbWickRatio}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) setField('rbWickRatio', clamp(v, 1, 20));
            }}
            className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-tv-text">
          <input
            type="checkbox"
            checked={options.rbRequireSweep}
            onChange={(e) => setField('rbRequireSweep', e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-tv-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span>Требовать sweep ликвидности</span>
            <span className="text-[10px] text-tv-text-muted">
              фитиль должен пробивать swing-high/low
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-tv-text">
            Прятать отработанные
          </span>
          <button
            type="button"
            onClick={() => setAll(!allChecked)}
            className="rounded border border-tv-border px-1.5 py-0.5 text-[10px] text-tv-text-muted hover:text-tv-text"
            aria-label={allChecked ? 'Снять все' : 'Включить все'}
          >
            {allChecked ? 'снять все' : someChecked ? 'все' : 'все'}
          </button>
        </div>
        {HIDE_TOGGLES.map((t) => (
          <label
            key={t.key}
            className="flex cursor-pointer items-start gap-2 text-xs text-tv-text"
          >
            <input
              type="checkbox"
              checked={options.hideMitigated[t.key]}
              onChange={(e) => setHideField(t.key, e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-tv-accent"
            />
            <span className="flex flex-col gap-0.5">
              <span>{t.label}</span>
              <span className="text-[10px] text-tv-text-muted">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {/* Ссылка на полное руководство — внизу карточки, отделена линией.
          Дублирует иконку «?» из Toolbox: пользователь, открывший настройки
          и не нашедший нужный параметр, попадает в подробное описание. */}
      {onOpenHelp && (
        <div className="mt-1 border-t border-tv-border pt-2">
          <button
            type="button"
            onClick={() => {
              onOpenHelp();
              onClose();
            }}
            className="text-[11px] text-tv-accent hover:underline"
          >
            Открыть полное руководство →
          </button>
        </div>
      )}
      </div>
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
