/**
 * Floating-меню, появляющееся при клике по POI-зоне.
 *
 * Показывает:
 *   - заголовок с диапазоном цен зоны
 *   - кнопку «Перейти на LTF» (HTF→LTF — выбранный младший ТФ пары)
 *   - кнопку «Удалить»
 *
 * Закрывается по клику снаружи или по Escape (через onClose).
 */

import { useEffect, useRef } from 'react';
import { ArrowDownToLine, Trash2, X } from 'lucide-react';
import type { POIZone } from '@/types';

interface ZoneMenuProps {
  zone: POIZone;
  /** Экранные координаты якоря (примерно правый-верхний угол зоны) */
  anchorX: number;
  anchorY: number;
  onJumpToLTF: (zone: POIZone) => void;
  onDelete: (zoneId: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 220;

export function ZoneMenu({
  zone,
  anchorX,
  anchorY,
  onJumpToLTF,
  onDelete,
  onClose,
}: ZoneMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Закрытие по клику снаружи
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    // Через timeout, чтобы текущий «открывающий» клик не закрыл меню сразу же.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [onClose]);

  // Подгоняем позицию, чтобы меню не вылезало за правый край окна.
  const left = Math.min(anchorX + 6, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.max(anchorY - 4, 8);

  const priceFmt = (n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top, width: MENU_WIDTH }}
      className="absolute z-40 rounded-md border border-tv-border bg-tv-panel/98 shadow-2xl backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-tv-border px-3 py-2">
        <div className="text-[11px] uppercase tracking-wider text-tv-text-muted">POI-зона</div>
        <button
          type="button"
          onClick={onClose}
          className="text-tv-text-muted hover:text-tv-text"
          title="Закрыть"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 font-mono text-xs text-tv-text-dim">
        <div>
          <span className="text-tv-text-muted">Цена: </span>
          <span className="text-tv-text">
            {priceFmt(zone.minPrice)} – {priceFmt(zone.maxPrice)}
          </span>
        </div>
        {zone.hasSignal && (
          <div className="mt-1 text-tv-up">✓ Сканер нашёл сигнал</div>
        )}
      </div>

      <div className="flex flex-col gap-px border-t border-tv-border">
        <MenuItem
          onClick={() => {
            onJumpToLTF(zone);
            onClose();
          }}
          accent
        >
          <ArrowDownToLine className="h-4 w-4" />
          Перейти на LTF
        </MenuItem>

        <MenuItem
          onClick={() => {
            onDelete(zone.id);
            onClose();
          }}
          danger
        >
          <Trash2 className="h-4 w-4" />
          Удалить
        </MenuItem>
      </div>
    </div>
  );
}

interface MenuItemProps {
  onClick: () => void;
  children: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}

function MenuItem({ onClick, children, accent = false, danger = false }: MenuItemProps) {
  let cls = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ';
  if (accent) {
    cls += 'text-tv-accent hover:bg-tv-accent/10';
  } else if (danger) {
    cls += 'text-tv-down hover:bg-tv-down/10';
  } else {
    cls += 'text-tv-text hover:bg-tv-panel-hover';
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
