/**
 * Глобальные горячие клавиши приложения.
 *
 * Не реагируем, если фокус на input/textarea/select или contenteditable —
 * это даёт возможность спокойно вводить текст в поля.
 *
 * Поддерживаются комбинации с модификаторами Ctrl/Cmd и Shift.
 * Запись модификаторов в ключе:
 *   "z"            → просто Z без модификаторов
 *   "mod+z"        → Ctrl+Z (Linux/Win) или Cmd+Z (macOS)
 *   "mod+shift+z"  → Ctrl/Cmd + Shift + Z
 *   "shift+a"      → Shift+A
 *
 * Префикс `mod` намеренно один — Ctrl на Win/Linux, Cmd (Meta) на macOS,
 * чтобы коллбэк работал на любой ОС без if-ов в App.
 */

import { useEffect } from 'react';

export type HotkeyMap = Record<string, () => void>;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

/**
 * Сводит KeyboardEvent в каноничную строку: ["mod+", "shift+"]?key.
 *
 * `event.key.toLowerCase()` даёт буквы/цифры/спец-имена (escape, arrowleft, …).
 * Mac: `metaKey` (Cmd), Win/Linux: `ctrlKey` — оба маппим в `mod`.
 *
 * Если зажаты обе (Ctrl+Cmd) — это не ошибка, считаем как `mod`.
 * Alt-комбинации игнорируем (системные шорткаты).
 */
function eventToKey(e: KeyboardEvent): string | null {
  if (e.altKey) return null;

  const key = e.key.toLowerCase();
  // Не реагируем на чистое нажатие модификатора — это часть комбинации,
  // а не самостоятельная клавиша. Иначе при подъёме Z мы дёргаем коллбэк.
  if (key === 'control' || key === 'meta' || key === 'shift' || key === 'alt') {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * Привязка по строковому ключу (см. формат в шапке файла).
 *
 * Хук стабилен по ссылке — переподписывается только при изменении содержимого map.
 */
export function useHotkeys(map: HotkeyMap): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const k = eventToKey(e);
      if (!k) return;

      const action = map[k];
      if (action) {
        // preventDefault в combo с Ctrl/Cmd — иначе у браузера сработает
        // "сохранить страницу" (Ctrl+S) или "новый таб" (Ctrl+T) и т.д.
        e.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [map]);
}
