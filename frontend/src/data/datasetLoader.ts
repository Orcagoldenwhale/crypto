/**
 * Загрузка готового датасета (JSON), сгенерированного Python-pipeline.
 *
 * Источники:
 *  1. Drag & drop файла в окно браузера
 *  2. Системный диалог `<input type="file">`
 *  3. URL (например, `/btcusdt-5d.json` рядом с index.html)
 *
 * Все три пути проходят через `parseDatasetJson` → строгая Zod-валидация.
 */

import type { Dataset } from '@/types';
import { parseDatasetJson, safeParseDatasetJson } from './datasetSchema';

/** Разумный лимит, чтобы случайно не подсунуть гигабайтник. 100 MB. */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Прочитать `File` (drag&drop или input) и распарсить как Dataset.
 *
 * Возвращает либо `{ok:true, data}` — готовый Dataset, либо `{ok:false, error}` —
 * человекочитаемое описание (для StatusBanner).
 */
export async function loadDatasetFromFile(
  file: File,
): Promise<{ ok: true; data: Dataset } | { ok: false; error: string }> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `Файл слишком большой: ${(file.size / 1024 / 1024).toFixed(1)} MB > 100 MB`,
    };
  }
  if (!file.name.toLowerCase().endsWith('.json')) {
    return { ok: false, error: `Ожидается .json, получено: ${file.name}` };
  }

  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return { ok: false, error: `Не удалось прочитать файл: ${(e as Error).message}` };
  }

  return safeParseDatasetJson(text);
}

/**
 * Загрузить датасет по URL (используется для авто-загрузки `/btcusdt-5d.json`
 * при старте приложения).
 *
 * Бросает ошибку с понятным сообщением — вызывающий код должен обернуть в try/catch.
 */
export async function loadDatasetFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<Dataset> {
  const opts: RequestInit = { cache: 'no-cache' };
  if (signal) opts.signal = signal;
  const res = await fetch(url, opts);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} при загрузке ${url}`);
  }
  const text = await res.text();
  // Здесь бросаем ZodError напрямую — у нас валидный URL, поэтому ошибка
  // схемы говорит о реальной проблеме с pipeline'ом, и её надо видеть в стэке.
  return parseDatasetJson(text);
}

// ============================================================================
// Drag & drop хелпер
// ============================================================================

/**
 * Из `DataTransfer` достать первый JSON-файл, если он там есть.
 * Возвращает `null` — если ни одного подходящего файла, или drop был внутри
 * текстового поля (не наш случай).
 */
export function pickJsonFile(dt: DataTransfer | null): File | null {
  if (!dt) return null;

  // Современные браузеры: dt.items.
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (!item) continue;
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (file.name.toLowerCase().endsWith('.json')) return file;
    }
  }

  // Fallback: dt.files.
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const file = dt.files[i];
      if (file && file.name.toLowerCase().endsWith('.json')) return file;
    }
  }

  return null;
}
