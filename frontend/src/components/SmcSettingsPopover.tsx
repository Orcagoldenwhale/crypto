/**
 * Полноэкранная модалка настроек SMC.
 *
 * Архитектура:
 *   - один общий контейнер на 90vw × 90vh;
 *   - адаптивный CSS-grid: 1 колонка на узких, 2 на средних, 3 на широких;
 *   - каждый раздел — отдельная карточка `<SectionCard>` с заголовком и
 *     своими настройками. Добавить новый раздел = добавить ещё одну карточку.
 *   - порядок секций: Общие → по индикаторам (FVG, Liquidity, Structure,
 *     OB, Breaker, Rejection).
 *
 * Закрытие: backdrop / Esc / крестик.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { SmcHideMitigated, SmcOptions } from '@/engine/smc/types';

interface SmcSettingsPopoverProps {
  options: SmcOptions;
  onChange: (next: SmcOptions) => void;
  onClose: () => void;
  onOpenHelp?: () => void;
  /** @deprecated не используется (модалка центрируется во viewport). */
  anchorX?: number;
  /** @deprecated не используется (модалка центрируется во viewport). */
  anchorY?: number;
}

export function SmcSettingsPopover({
  options,
  onChange,
  onClose,
  onOpenHelp,
}: SmcSettingsPopoverProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const setField = <K extends keyof SmcOptions>(key: K, value: SmcOptions[K]) => {
    onChange({ ...options, [key]: value });
  };

  const setHide = (key: keyof SmcHideMitigated, value: boolean) => {
    onChange({
      ...options,
      hideMitigated: { ...options.hideMitigated, [key]: value },
    });
  };

  const hideKeys: (keyof SmcHideMitigated)[] = [
    'fvg', 'liquidity', 'structure', 'orderBlocks', 'breakerBlocks', 'rejectionBlocks',
  ];
  const allHidden = hideKeys.every((k) => options.hideMitigated[k]);
  const setAllHide = (v: boolean) => {
    const next: SmcHideMitigated = {
      fvg: v, liquidity: v, structure: v, orderBlocks: v, breakerBlocks: v, rejectionBlocks: v,
    };
    onChange({ ...options, hideMitigated: next });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={modalRef}
        className="flex h-[90vh] w-[90vw] max-w-7xl flex-col rounded-lg border border-tv-border bg-tv-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Настройки SMC"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-tv-border px-5 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-semibold uppercase tracking-wider text-tv-text">
              Настройки SMC
            </span>
            <button
              type="button"
              onClick={() => setAllHide(!allHidden)}
              className="rounded border border-tv-border px-2 py-0.5 text-[10px] text-tv-text-muted hover:text-tv-text"
            >
              {allHidden ? 'Показать всё отработанное' : 'Скрыть всё отработанное'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {onOpenHelp && (
              <button
                type="button"
                onClick={() => { onOpenHelp(); onClose(); }}
                className="text-xs text-tv-accent hover:underline"
              >
                Полное руководство →
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-tv-text-muted hover:text-tv-text"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Grid of sections */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">

            <SectionCard title="Общие" subtitle="Параметры структурного анализа">
              <NumberField
                label="Lookback (свечи)"
                hint="окно swing-points с каждой стороны"
                value={options.lookback}
                min={2}
                max={50}
                step={1}
                onChange={(v) => setField('lookback', v)}
              />
              <NumberField
                label="Допуск equal-highs/lows (%)"
                hint="близость двух swing-points как доля от цены"
                value={+(options.equalityTolerancePct * 100).toFixed(2)}
                min={0}
                max={5}
                step={0.05}
                onChange={(v) => setField('equalityTolerancePct', v / 100)}
              />
            </SectionCard>

            <SectionCard title="FVG" subtitle="Fair Value Gaps">
              <NumberField
                label="Fill-порог (%)"
                hint="FVG валиден, пока не перекрыт более чем на X%"
                value={options.fvgMaxFillPct}
                min={0}
                max={100}
                step={5}
                onChange={(v) => setField('fvgMaxFillPct', v)}
              />
              <NumberField
                label="Мин. размер FVG (%)"
                hint="FVG меньше порога не отображаются"
                value={options.minFvgPct}
                min={0}
                max={5}
                step={0.05}
                onChange={(v) => setField('minFvgPct', v)}
              />
              <CheckboxRow
                label="Прятать отработанные"
                hint="цена возвращалась в зону"
                checked={options.hideMitigated.fvg}
                onChange={(v) => setHide('fvg', v)}
              />
            </SectionCard>

            <SectionCard title="Liquidity" subtitle="Equal highs / lows, sweeps">
              <CheckboxRow
                label="Прятать отработанные"
                hint="ликвидность уже снята (был sweep)"
                checked={options.hideMitigated.liquidity}
                onChange={(v) => setHide('liquidity', v)}
              />
            </SectionCard>

            <SectionCard title="Structure" subtitle="BOS / CHoCH + retest">
              <CheckboxRow
                label="Прятать отработанные"
                hint="BOS/CHoCH с уже состоявшимся retest"
                checked={options.hideMitigated.structure}
                onChange={(v) => setHide('structure', v)}
              />
            </SectionCard>

            <SectionCard title="Order Blocks" subtitle="Классический OB и его варианты">
              <SelectField
                label="Выделение OB"
                hint="wicks — по фитилям, body — по телу, auto — авто"
                value={options.obExtraction}
                onChange={(v) => setField('obExtraction', v as SmcOptions['obExtraction'])}
                options={[
                  { value: 'wicks', label: 'По фитилям (wicks)' },
                  { value: 'body', label: 'По телу (body)' },
                  { value: 'auto', label: 'Авто (auto)' },
                ]}
              />
              <CheckboxRow
                label="Учитывать Mean Threshold"
                hint="OB живёт пока тело свечи не закрылось за 50% от тела OB"
                checked={options.obUseMeanThreshold}
                onChange={(v) => setField('obUseMeanThreshold', v)}
              />
              <CheckboxRow
                label="Требовать поглощение телом"
                hint="импульсная свеча должна закрыться за телом OB"
                checked={options.obRequireAbsorption}
                onChange={(v) => setField('obRequireAbsorption', v)}
              />
              <CheckboxRow
                label="Прятать отработанные"
                hint="цена касалась OB"
                checked={options.hideMitigated.orderBlocks}
                onChange={(v) => setHide('orderBlocks', v)}
              />
            </SectionCard>

            <SectionCard title="Breaker Blocks" subtitle="Пробитый OB с разворотом структуры">
              <CheckboxRow
                label="Прятать отработанные"
                hint="цена касалась BB"
                checked={options.hideMitigated.breakerBlocks}
                onChange={(v) => setHide('breakerBlocks', v)}
              />
            </SectionCard>

            <SectionCard title="Rejection Blocks" subtitle="Длинный фитиль на снятии ликвидности">
              <NumberField
                label="Фитиль / тело (≥)"
                hint="свеча считается RB только если фитиль ≥ N × тело"
                value={options.rbWickRatio}
                min={1}
                max={20}
                step={0.5}
                onChange={(v) => setField('rbWickRatio', v)}
              />
              <CheckboxRow
                label="Требовать sweep ликвидности"
                hint="фитиль должен пробивать swing-high/low"
                checked={options.rbRequireSweep}
                onChange={(v) => setField('rbRequireSweep', v)}
              />
              <CheckboxRow
                label="Прятать отработанные"
                hint="цена возвращалась внутрь фитиля"
                checked={options.hideMitigated.rejectionBlocks}
                onChange={(v) => setHide('rejectionBlocks', v)}
              />
            </SectionCard>

          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Building blocks
// ============================================================================

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-tv-border bg-tv-bg-deep/40 p-4">
      <header className="flex flex-col gap-0.5 border-b border-tv-border pb-2">
        <h3 className="text-sm font-semibold text-tv-text">{title}</h3>
        {subtitle && (
          <p className="text-[10px] text-tv-text-muted">{subtitle}</p>
        )}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-tv-text">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(clamp(v, min, max));
        }}
        className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
      />
      {hint && <span className="text-[10px] text-tv-text-muted">{hint}</span>}
    </label>
  );
}

function SelectField({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-tv-text">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-tv-border bg-tv-bg-deep px-2 py-1 text-xs text-tv-text outline-none focus:border-tv-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <span className="text-[10px] text-tv-text-muted">{hint}</span>}
    </label>
  );
}

function CheckboxRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-tv-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 accent-tv-accent"
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-[10px] text-tv-text-muted">{hint}</span>}
      </span>
    </label>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
