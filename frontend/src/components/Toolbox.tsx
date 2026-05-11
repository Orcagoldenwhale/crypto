import {
  MousePointer2,
  Square,
  Search,
  Trash2,
  Undo2,
  Redo2,
  Sparkles,
  Waves,
  Activity,
  Package,
  PackageOpen,
  Flame,
  Settings,
  HelpCircle,
} from 'lucide-react';
import type { SmcLayers } from '@/engine/smc/types';

export type Tool = 'pointer' | 'rectangle';

interface ToolboxProps {
  tool: Tool;
  /** true = на экране старший ТФ — можно рисовать зоны при активном rectangle. */
  zoneDrawingEnabled: boolean;
  zonesCount: number;
  hasData: boolean;
  scannerRunning: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Состояние SMC-слоёв. Если null — индикатор недоступен (например, на LTF
   * при двухуровневой паре): строка тогглов скрывается.
   */
  smcLayers: SmcLayers | null;
  onToggleSmcLayer?: (layer: keyof SmcLayers) => void;
  onOpenSmcSettings?: (anchorX: number, anchorY: number) => void;
  /** Открыть полное руководство (модалку HelpModal). */
  onOpenHelp?: () => void;
  onSelectTool: (tool: Tool) => void;
  onRunScanner: () => void;
  onClearAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function Toolbox({
  tool,
  zoneDrawingEnabled,
  zonesCount,
  hasData,
  scannerRunning,
  canUndo,
  canRedo,
  smcLayers,
  onToggleSmcLayer,
  onOpenSmcSettings,
  onOpenHelp,
  onSelectTool,
  onRunScanner,
  onClearAll,
  onUndo,
  onRedo,
}: ToolboxProps) {
  const drawingDisabled = !zoneDrawingEnabled;
  const clearDisabled = zonesCount === 0;
  // Поиск разрешён, если есть данные. Без зон сканер работает в explore-режиме.
  const scanDisabled = !hasData || scannerRunning;
  const scanTitle = scannerRunning
    ? 'Сканер работает…'
    : zonesCount === 0
      ? 'Поиск входов · explore (S) — без зон, по всему датасету'
      : `Поиск входов · по ${zonesCount} ${pluralize(zonesCount, 'зоне', 'зонам', 'зонам')} (S)`;

  // На macOS показываем символ Cmd ⌘, на Win/Linux — Ctrl. Маленький UX-нюанс.
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <div className="absolute top-2 left-4 z-20 flex flex-col gap-1 rounded-lg border border-tv-border bg-tv-panel/95 p-1.5 shadow-2xl backdrop-blur-sm">
      <ToolButton
        title="Навигация (V)"
        active={tool === 'pointer'}
        onClick={() => onSelectTool('pointer')}
      >
        <MousePointer2 className="h-5 w-5" />
      </ToolButton>

      <ToolButton
        title={
          drawingDisabled
            ? 'Разметка только на HTF (переключите режим вверху)'
            : 'Разметка POI (R)'
        }
        active={tool === 'rectangle'}
        accent={tool === 'rectangle'}
        disabled={drawingDisabled}
        onClick={() => onSelectTool('rectangle')}
      >
        <Square className="h-5 w-5" />
      </ToolButton>

      <div className="mx-auto my-0.5 h-px w-6 bg-tv-border" />

      <ToolButton
        title={canUndo ? `Отменить (${modKey}+Z)` : 'Нечего отменять'}
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 className="h-5 w-5" />
      </ToolButton>

      <ToolButton
        title={canRedo ? `Повторить (${modKey}+Shift+Z)` : 'Нечего повторять'}
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 className="h-5 w-5" />
      </ToolButton>

      <div className="mx-auto my-0.5 h-px w-6 bg-tv-border" />

      <ToolButton
        title={scanTitle}
        success
        disabled={scanDisabled}
        onClick={onRunScanner}
      >
        <Search className="h-5 w-5" />
      </ToolButton>

      <ToolButton
        title={clearDisabled ? 'Нет зон для очистки' : 'Очистить все зоны'}
        danger
        disabled={clearDisabled}
        onClick={onClearAll}
      >
        <Trash2 className="h-5 w-5" />
      </ToolButton>

      {/* SMC-индикатор: показываем только там, где он активен (HTF/single). */}
      {smcLayers && (
        <>
          <div className="mx-auto my-0.5 h-px w-6 bg-tv-border" />
          <ToolButton
            title={
              smcLayers.fvg
                ? 'FVG: показано (выкл.)'
                : 'FVG: скрыто (вкл.)'
            }
            active={smcLayers.fvg}
            onClick={() => onToggleSmcLayer?.('fvg')}
          >
            <Sparkles className="h-5 w-5" />
          </ToolButton>
          <ToolButton
            title={
              smcLayers.liquidity
                ? 'Liquidity: показано (выкл.)'
                : 'Liquidity: скрыто (вкл.)'
            }
            active={smcLayers.liquidity}
            onClick={() => onToggleSmcLayer?.('liquidity')}
          >
            <Waves className="h-5 w-5" />
          </ToolButton>
          <ToolButton
            title={
              smcLayers.structure
                ? 'Структура (BOS/CHoCH): показано (выкл.)'
                : 'Структура (BOS/CHoCH): скрыто (вкл.)'
            }
            active={smcLayers.structure}
            onClick={() => onToggleSmcLayer?.('structure')}
          >
            <Activity className="h-5 w-5" />
          </ToolButton>
          <ToolButton
            title={
              smcLayers.orderBlocks
                ? 'Order Blocks: показано (выкл.)'
                : 'Order Blocks: скрыто (вкл.)'
            }
            active={smcLayers.orderBlocks}
            onClick={() => onToggleSmcLayer?.('orderBlocks')}
          >
            <Package className="h-5 w-5" />
          </ToolButton>
          <ToolButton
            title={
              smcLayers.breakerBlocks
                ? 'Breaker Blocks: показано (выкл.)'
                : 'Breaker Blocks: скрыто (вкл.)'
            }
            active={smcLayers.breakerBlocks}
            onClick={() => onToggleSmcLayer?.('breakerBlocks')}
          >
            <PackageOpen className="h-5 w-5" />
          </ToolButton>
          <ToolButton
            title={
              smcLayers.rejectionBlocks
                ? 'Rejection Blocks: показано (выкл.)'
                : 'Rejection Blocks: скрыто (вкл.)'
            }
            active={smcLayers.rejectionBlocks}
            onClick={() => onToggleSmcLayer?.('rejectionBlocks')}
          >
            <Flame className="h-5 w-5" />
          </ToolButton>
          <ToolButton
            title="Настройки SMC"
            onClick={(ev) => {
              const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              // Якорим popover к правому краю кнопки + небольшой gap.
              onOpenSmcSettings?.(r.right + 6, r.top);
            }}
          >
            <Settings className="h-5 w-5" />
          </ToolButton>
        </>
      )}

      {/* Полное руководство — всегда внизу панели, отделено разделителем. */}
      {onOpenHelp && (
        <>
          <div className="mx-auto my-0.5 h-px w-6 bg-tv-border" />
          <ToolButton title="Полное руководство (?)" onClick={onOpenHelp}>
            <HelpCircle className="h-5 w-5" />
          </ToolButton>
        </>
      )}
    </div>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

interface ToolButtonProps {
  title: string;
  active?: boolean;
  accent?: boolean;
  success?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

function ToolButton({
  title,
  active = false,
  accent = false,
  success = false,
  danger = false,
  disabled = false,
  onClick,
  children,
}: ToolButtonProps) {
  const base =
    'w-10 h-10 flex items-center justify-center rounded-md transition-all';
  let cls: string;

  if (disabled) {
    cls = `${base} text-tv-text-muted opacity-30 cursor-not-allowed`;
  } else if (accent) {
    cls = `${base} bg-tv-accent text-white`;
  } else if (success) {
    cls = `${base} bg-tv-up hover:bg-tv-up-hover text-white shadow-lg shadow-emerald-900/30`;
  } else if (danger) {
    cls = `${base} text-tv-text-dim hover:text-tv-down hover:bg-tv-down/10`;
  } else if (active) {
    cls = `${base} bg-tv-panel-hover text-tv-accent`;
  } else {
    cls = `${base} text-tv-text-dim hover:text-tv-text hover:bg-tv-panel-hover/50`;
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cls}
    >
      {children}
    </button>
  );
}
