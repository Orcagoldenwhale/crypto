/**
 * Generic-стек undo/redo для редактируемых операций.
 *
 * Архитектура:
 *   - Чистая фабрика `createUndoStack<T>()` — без React. Так её
 *     можно тестировать как обычный класс и переиспользовать в
 *     несколько мест без накладных расходов на хуки.
 *   - Тонкий React-хук `useUndoStack<T>()` оборачивает фабрику в useRef,
 *     чтобы экземпляр жил на всё время компонента и не пересоздавался.
 *
 * Семантика:
 *   - Каждая операция — это объект `Action` с `apply` и `revert`.
 *   - history — массив УЖЕ применённых action-ов.
 *   - future  — массив отменённых action-ов (готовые к redo).
 *   - При push: history += action; future = []  (любая новая правка
 *     инвалидирует redo, чтобы не попасть в несовместимое состояние).
 *   - При undo: action = history.pop(); revert(action); future.push(action).
 *   - При redo: action = future.pop(); apply(action);  history.push(action).
 *   - Лимит истории `maxSize` (по умолчанию 50) — отбрасываем старые
 *     действия, чтобы не утекала память за длинную сессию.
 */

import { useRef } from 'react';

export interface UndoableAction<T> {
  /** Полезная нагрузка — описывает суть операции для caller. */
  payload: T;
  /** Применить операцию (вперёд). Вызывается при redo. */
  apply: () => void;
  /** Отменить операцию (назад). Вызывается при undo. */
  revert: () => void;
}

export interface UndoStackApi<T> {
  pushAction: (action: UndoableAction<T>) => void;
  undo: () => boolean;
  redo: () => boolean;
  /** Чистит и историю, и будущее (например, при загрузке нового датасета). */
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Размер истории — для отладки и UI-индикаторов. */
  size: () => { history: number; future: number };
}

interface Options {
  /** Максимальное число действий в истории. По умолчанию 50. */
  maxSize?: number;
}

/**
 * Чистая фабрика стека undo/redo. НЕ ТРЕБУЕТ React — можно использовать
 * в Web Worker, Node, тестах. Для использования в компонентах есть
 * `useUndoStack`.
 */
export function createUndoStack<T>(opts: Options = {}): UndoStackApi<T> {
  const maxSize = Math.max(1, opts.maxSize ?? 50);
  const history: UndoableAction<T>[] = [];
  let future: UndoableAction<T>[] = [];

  return {
    pushAction(action) {
      history.push(action);
      if (history.length > maxSize) {
        history.splice(0, history.length - maxSize);
      }
      // Любая новая правка делает redo-стек невалидным.
      if (future.length > 0) future = [];
    },
    undo() {
      const action = history.pop();
      if (!action) return false;
      action.revert();
      future.push(action);
      return true;
    },
    redo() {
      const action = future.pop();
      if (!action) return false;
      action.apply();
      history.push(action);
      return true;
    },
    clear() {
      history.length = 0;
      future = [];
    },
    canUndo() {
      return history.length > 0;
    },
    canRedo() {
      return future.length > 0;
    },
    size() {
      return { history: history.length, future: future.length };
    },
  };
}

/**
 * React-хук — обёртка над `createUndoStack`. Хранит экземпляр в useRef,
 * чтобы он не пересоздавался между рендерами.
 */
export function useUndoStack<T>(opts: Options = {}): UndoStackApi<T> {
  const ref = useRef<UndoStackApi<T> | null>(null);
  if (!ref.current) {
    ref.current = createUndoStack<T>(opts);
  }
  return ref.current;
}
