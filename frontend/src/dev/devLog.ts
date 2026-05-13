/**
 * Dev-only канал логирования: POST в /api/dev-log → Vite-middleware пишет
 * строку JSON в `frontend/dev-log.txt`. Файл читается AI-ассистентом для
 * быстрой диагностики, не нужен copy/paste из browser-console.
 *
 * В production no-op (флаг `import.meta.env.DEV`).
 *
 * Использование:
 *   devLog('extended-bt', { candleCount, overlay_counts, trades: report.totalTrades });
 *
 * Файл `dev-log.txt` в gitignore (не коммитим, это рабочий артефакт).
 */

/** Записывает одну строку JSON в `frontend/dev-log.txt`. Прода — no-op. */
export function devLog(tag: string, payload: unknown): void {
  if (!import.meta.env.DEV) return;
  try {
    const body = JSON.stringify({
      ts: new Date().toISOString(),
      tag,
      payload,
    });
    void fetch('/api/dev-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {
      /* dev-only, тихо игнорируем offline-режим */
    });
  } catch {
    /* serialize ошибки игнорируем — не критично */
  }
}

/** Очищает файл `frontend/dev-log.txt`. Прода — no-op. */
export function devLogClear(): void {
  if (!import.meta.env.DEV) return;
  try {
    void fetch('/api/dev-log', { method: 'DELETE' }).catch(() => {
      /* dev-only */
    });
  } catch {
    /* ignore */
  }
}
