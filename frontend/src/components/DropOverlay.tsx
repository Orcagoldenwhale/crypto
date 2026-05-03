import { Upload } from 'lucide-react';

interface DropOverlayProps {
  visible: boolean;
}

/**
 * Полноэкранный полупрозрачный оверлей, который показывается когда
 * пользователь тащит файл над окном. Подсвечивает «зону приёма».
 *
 * Сам по себе НЕ обрабатывает события — это делает `useDropZone` на window.
 * Здесь только визуал, поэтому `pointer-events-none`, чтобы не мешать.
 */
export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-tv-accent/15 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-tv-accent/80 bg-tv-panel/95 px-10 py-8 text-center shadow-2xl">
        <Upload size={40} className="text-tv-accent" />
        <div className="text-base font-semibold text-tv-text">Бросьте JSON-датасет сюда</div>
        <div className="text-xs text-tv-text-dim">
          Файл, сгенерированный <code className="font-mono">smc-data</code> · до 100 MB
        </div>
      </div>
    </div>
  );
}
