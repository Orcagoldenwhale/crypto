import { describe, expect, it } from 'vitest';
import { createUndoStack } from './useUndoStack';

interface Counter {
  v: number;
}

function makeIncrementAction(state: Counter, delta: number) {
  return {
    payload: { delta },
    apply: () => {
      state.v += delta;
    },
    revert: () => {
      state.v -= delta;
    },
  };
}

describe('createUndoStack', () => {
  it('пустой стек — undo/redo возвращают false', () => {
    const s = createUndoStack<{ delta: number }>();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('push → undo откатывает применённое действие', () => {
    const state: Counter = { v: 0 };
    const s = createUndoStack<{ delta: number }>();

    const a = makeIncrementAction(state, 5);
    a.apply();
    s.pushAction(a);
    expect(state.v).toBe(5);
    expect(s.canUndo()).toBe(true);

    s.undo();
    expect(state.v).toBe(0);
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(true);
  });

  it('undo → redo возвращает действие обратно', () => {
    const state: Counter = { v: 0 };
    const s = createUndoStack<{ delta: number }>();

    const a = makeIncrementAction(state, 7);
    a.apply();
    s.pushAction(a);
    s.undo();
    expect(state.v).toBe(0);

    s.redo();
    expect(state.v).toBe(7);
    expect(s.canRedo()).toBe(false);
  });

  it('новый push после undo инвалидирует future', () => {
    const state: Counter = { v: 0 };
    const s = createUndoStack<{ delta: number }>();

    const a1 = makeIncrementAction(state, 3);
    a1.apply();
    s.pushAction(a1);

    s.undo();
    expect(s.canRedo()).toBe(true);

    const a2 = makeIncrementAction(state, 10);
    a2.apply();
    s.pushAction(a2);

    expect(state.v).toBe(10);
    expect(s.canRedo()).toBe(false);
  });

  it('multiple undo/redo соблюдают LIFO-порядок', () => {
    const state: Counter = { v: 0 };
    const s = createUndoStack<{ delta: number }>();

    for (const d of [1, 2, 4]) {
      const a = makeIncrementAction(state, d);
      a.apply();
      s.pushAction(a);
    }
    expect(state.v).toBe(7);

    s.undo();
    expect(state.v).toBe(3);
    s.undo();
    expect(state.v).toBe(1);
    s.undo();
    expect(state.v).toBe(0);

    s.redo();
    s.redo();
    expect(state.v).toBe(3);
  });

  it('лимит истории отбрасывает самые старые', () => {
    const state: Counter = { v: 0 };
    const s = createUndoStack<{ delta: number }>({ maxSize: 3 });

    for (const d of [1, 2, 4, 8, 16]) {
      const a = makeIncrementAction(state, d);
      a.apply();
      s.pushAction(a);
    }
    expect(state.v).toBe(31);
    expect(s.size().history).toBe(3);

    // 3 undo откатят 16, 8, 4 → state.v = 1+2 = 3
    s.undo();
    s.undo();
    s.undo();
    expect(state.v).toBe(3);
    expect(s.canUndo()).toBe(false);
  });

  it('clear() очищает историю и future', () => {
    const state: Counter = { v: 0 };
    const s = createUndoStack<{ delta: number }>();

    const a = makeIncrementAction(state, 5);
    a.apply();
    s.pushAction(a);
    s.undo();
    s.clear();

    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });
});
