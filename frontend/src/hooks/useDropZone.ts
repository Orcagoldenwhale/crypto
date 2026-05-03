/**
 * Глобальный drag & drop поверх всего приложения.
 *
 * - Слушает `dragenter` / `dragover` / `dragleave` / `drop` на `window`.
 * - Включает оверлей-флаг `isDragging`, пока хотя бы один dragenter-counter > 0.
 *   (Браузеры стреляют dragenter/leave на каждый дочерний элемент — поэтому нужен счётчик.)
 * - На drop — извлекает первый JSON-файл и вызывает `onFile`.
 * - Все default-действия браузера блокируются, чтобы файл не открылся в новой вкладке.
 */

import { useEffect, useState } from 'react';
import { pickJsonFile } from '@/data/datasetLoader';

export interface UseDropZoneOptions {
  /** Колбэк вызывается, когда пользователь бросил .json файл. */
  onFile: (file: File) => void;
  /** Если drop случился, но не нашлось .json — сюда. Опционально. */
  onReject?: (reason: string) => void;
  /** Отключить целиком (например, во время загрузки). */
  disabled?: boolean;
}

export function useDropZone(opts: UseDropZoneOptions): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (opts.disabled) return;

    let counter = 0;

    const isFileDrag = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      // 'Files' появляется только когда тащат именно файлы из ОС.
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
      }
      return false;
    };

    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      counter += 1;
      if (counter === 1) setIsDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      // Указываем браузеру правильный курсор.
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      counter = Math.max(0, counter - 1);
      if (counter === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      counter = 0;
      setIsDragging(false);

      const file = pickJsonFile(e.dataTransfer);
      if (file) {
        opts.onFile(file);
      } else {
        opts.onReject?.('Можно перетащить только .json — других файлов в drop не найдено.');
      }
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [opts]);

  return { isDragging };
}
