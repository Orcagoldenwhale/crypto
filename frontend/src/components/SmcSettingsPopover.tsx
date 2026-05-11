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
import type { SmcHideMitigated, SmcLayers, SmcOptions } from '@/engine/smc/types';

interface SmcSettingsPopoverProps {
  options: SmcOptions;
  onChange: (next: SmcOptions) => void;
  layers: SmcLayers;
  onLayersChange: (next: SmcLayers) => void;
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
  layers,
  onLayersChange,
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

  const setLayer = (key: keyof SmcLayers, value: boolean) => {
    onLayersChange({ ...layers, [key]: value });
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

            <SectionCard title="Liquidity" subtitle="Equal highs / lows, PDH/PDL">
              <SubSection title="EQH / EQL">
                <CheckboxRow
                  label="External (за пределами range)"
                  hint="главные цели — уровни выше последнего swing high / ниже swing low"
                  checked={options.liqShowExternal}
                  onChange={(v) => setField('liqShowExternal', v)}
                />
                <CheckboxRow
                  label="Internal (внутри range)"
                  hint="промежуточная ликвидность — чаще снимается по пути"
                  checked={options.liqShowInternal}
                  onChange={(v) => setField('liqShowInternal', v)}
                />
                <CheckboxRow
                  label="Подписи как BSL/SSL"
                  hint="вместо EQH/EQL использовать BSL (buy-side) / SSL (sell-side)"
                  checked={options.liqUseBslSslLabels}
                  onChange={(v) => setField('liqUseBslSslLabels', v)}
                />
                <CheckboxRow
                  label="Прятать отработанные"
                  hint="ликвидность уже снята (был sweep)"
                  checked={options.hideMitigated.liquidity}
                  onChange={(v) => setHide('liquidity', v)}
                />
              </SubSection>

              <SubSection
                title="Previous Day (PDH/PDL)"
                subtitle="Максимум/минимум предыдущего дня — интрадей-цели"
                enableLabel="Включить"
                enabled={options.liqShowPrevDay}
                onEnabledChange={(v) => setField('liqShowPrevDay', v)}
              >
                <p className="text-[10px] text-tv-text-muted">
                  Линии рисуются с 00:00 UTC следующего дня. После пересечения
                  ценой — становятся серыми (теряют актуальность).
                </p>
              </SubSection>

              <SubSection
                title="Compression"
                subtitle="Серии swing-точек в корректирующих движениях"
                enableLabel="Включить"
                enabled={options.liqShowCompression}
                onEnabledChange={(v) => setField('liqShowCompression', v)}
              >
                <NumberField
                  label="Мин. точек в серии"
                  hint="3 = умеренно, 4+ = только глубокие коррекции"
                  value={options.liqCompressionMinPoints}
                  min={2}
                  max={10}
                  step={1}
                  onChange={(v) => setField('liqCompressionMinPoints', Math.round(v))}
                />
              </SubSection>
            </SectionCard>

            <SectionCard title="Structure" subtitle="BOS / CHoCH + retest">
              <CheckboxRow
                label="Прятать отработанные"
                hint="BOS/CHoCH с уже состоявшимся retest"
                checked={options.hideMitigated.structure}
                onChange={(v) => setHide('structure', v)}
              />
            </SectionCard>

            <SectionCard
              title="Order Blocks"
              subtitle="Базовый OB + расширения: Breaker, Rejection"
              className="md:col-span-2"
            >
              <SubSection title="Базовый OB">
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
                  hint="OB живёт пока тело свечи не закрылось за 50% тела OB"
                  checked={options.obUseMeanThreshold}
                  onChange={(v) => setField('obUseMeanThreshold', v)}
                />
                <CheckboxRow
                  label="Требовать поглощение телом"
                  hint="импульсная свеча должна закрыться за телом OB"
                  checked={options.obRequireAbsorption}
                  onChange={(v) => setField('obRequireAbsorption', v)}
                />

                <div className="border-t border-tv-border/40 pt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-tv-text-muted">
                    Также искать OB в этих зонах (лекция §3)
                  </p>
                  <p className="mb-2 text-[10px] text-tv-text-muted">
                    Кроме BOS/CHoCH — каждый тоггл добавляет ещё один проход
                    обнаружения OB. Помогает не пропускать блоки.
                  </p>
                  <div className="flex flex-col gap-2">
                    <CheckboxRow
                      label="На снятии ликвидности (sweep)"
                      hint="для каждого sweep swing-уровня ищем OB + импульс разворота"
                      checked={options.obSearchAtSweep}
                      onChange={(v) => setField('obSearchAtSweep', v)}
                    />
                    <CheckboxRow
                      label="На тесте FVG (ребаланс)"
                      hint="при возврате цены в FVG — OB + импульс продолжения"
                      checked={options.obSearchAtFvg}
                      onChange={(v) => setField('obSearchAtFvg', v)}
                    />
                    <CheckboxRow
                      label="На тесте предыдущего OB"
                      hint="при возврате цены в ранее сформированный OB — новый OB на ретесте"
                      checked={options.obSearchAtPrevBlock}
                      onChange={(v) => setField('obSearchAtPrevBlock', v)}
                    />
                  </div>
                </div>

                <CheckboxRow
                  label="Multi-candle OB (STB/BTS)"
                  hint="расширять OB на серию однонаправленных свеч перед break"
                  checked={options.obAllowMultiCandle}
                  onChange={(v) => setField('obAllowMultiCandle', v)}
                />
                {options.obAllowMultiCandle && (
                  <NumberField
                    label="Макс. свеч в группе"
                    hint="ограничение длины multi-candle OB"
                    value={options.obMultiCandleMax}
                    min={2}
                    max={5}
                    step={1}
                    onChange={(v) => setField('obMultiCandleMax', Math.round(v))}
                  />
                )}
                <CheckboxRow
                  label="Прятать отработанные"
                  hint="цена касалась OB"
                  checked={options.hideMitigated.orderBlocks}
                  onChange={(v) => setHide('orderBlocks', v)}
                />
              </SubSection>

              <SubSection
                title="Breaker Block (BB)"
                subtitle="Пробитый OB с разворотом структуры"
                enableLabel="Включить BB"
                enabled={layers.breakerBlocks}
                onEnabledChange={(v) => setLayer('breakerBlocks', v)}
              >
                <CheckboxRow
                  label="Прятать отработанные"
                  hint="цена касалась BB"
                  checked={options.hideMitigated.breakerBlocks}
                  onChange={(v) => setHide('breakerBlocks', v)}
                />
              </SubSection>

              <SubSection
                title="Rejection Block (RB)"
                subtitle="Длинный фитиль на снятии ликвидности"
                enableLabel="Включить RB"
                enabled={layers.rejectionBlocks}
                onEnabledChange={(v) => setLayer('rejectionBlocks', v)}
              >
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
                <div className="border-t border-tv-border/40 pt-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-tv-text-muted">
                    Доп. источники "снятия" (лекция §3)
                  </p>
                  <p className="mb-2 text-[10px] text-tv-text-muted">
                    Расширяют требование выше — RB валиден если фитиль зашёл
                    в любую из включённых зон ИЛИ снял swing-уровень.
                  </p>
                  <div className="flex flex-col gap-2">
                    <CheckboxRow
                      label="Фитиль в FVG"
                      hint="RB засчитывается если фитиль зашёл в существующий FVG"
                      checked={options.rbAlsoAtFvg}
                      onChange={(v) => setField('rbAlsoAtFvg', v)}
                    />
                    <CheckboxRow
                      label="Фитиль в предыдущий OB/BB"
                      hint="RB засчитывается если фитиль зашёл в ранее найденный блок"
                      checked={options.rbAlsoAtPrevBlock}
                      onChange={(v) => setField('rbAlsoAtPrevBlock', v)}
                    />
                  </div>
                </div>
                <CheckboxRow
                  label="Прятать отработанные"
                  hint="цена возвращалась внутрь фитиля"
                  checked={options.hideMitigated.rejectionBlocks}
                  onChange={(v) => setHide('rejectionBlocks', v)}
                />
              </SubSection>
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
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 rounded-md border border-tv-border bg-tv-bg-deep/40 p-4 ${className ?? ''}`}>
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

/**
 * Подсекция внутри карточки. Если переданы `enabled` + `onEnabledChange` —
 * наверху показывается toggle с заголовком, и содержимое блёкнет когда выкл.
 */
function SubSection({
  title,
  subtitle,
  children,
  enabled,
  onEnabledChange,
  enableLabel,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  enabled?: boolean;
  onEnabledChange?: (v: boolean) => void;
  enableLabel?: string;
}) {
  const hasToggle = typeof enabled === 'boolean' && onEnabledChange;
  return (
    <div className="flex flex-col gap-2 rounded border border-tv-border/60 bg-tv-bg-deep/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h4 className="text-[12px] font-semibold text-tv-text">{title}</h4>
          {subtitle && (
            <p className="text-[10px] text-tv-text-muted">{subtitle}</p>
          )}
        </div>
        {hasToggle && (
          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[10px] text-tv-text-muted">
            <span>{enableLabel ?? 'Вкл'}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onEnabledChange!(e.target.checked)}
              className="h-3.5 w-3.5 accent-tv-accent"
            />
          </label>
        )}
      </div>
      <div className={`flex flex-col gap-3 ${hasToggle && !enabled ? 'pointer-events-none opacity-40' : ''}`}>
        {children}
      </div>
    </div>
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
