/**
 * Web Worker, выполняющий сканирование сигналов в фоновом потоке.
 *
 * Использование (в main thread):
 *   const w = new Worker(new URL('./scannerWorker.ts', import.meta.url), { type: 'module' });
 *   w.postMessage({ candles, zones } satisfies ScannerWorkerRequest);
 *   w.onmessage = (e: MessageEvent<ScannerWorkerResponse>) => { ... };
 *
 * Vite поддерживает такую конструкцию из коробки и сам производит код-сплит
 * для воркера, поэтому он не попадает в основной bundle.
 */

import { runScanner } from './runScanner';
import type { Candle5m, POIZone } from '@/types';
import type { RunScannerResult } from './runScanner';

export interface ScannerWorkerRequest {
  candles: readonly Candle5m[];
  zones: readonly POIZone[];
}

export type ScannerWorkerResponse =
  | {
      kind: 'done';
      /** Time spent inside the worker, ms */
      elapsedMs: number;
      /** Set сериализуется плохо, отдаём массивом и собираем обратно в main. */
      signals: RunScannerResult['signals'];
      zoneIdsWithSignal: string[];
      report: RunScannerResult['report'];
    }
  | {
      kind: 'error';
      message: string;
    };

self.onmessage = (e: MessageEvent<ScannerWorkerRequest>) => {
  const t0 = performance.now();
  try {
    const { candles, zones } = e.data;
    const result = runScanner({ candles, zones });
    const response: ScannerWorkerResponse = {
      kind: 'done',
      elapsedMs: performance.now() - t0,
      signals: result.signals,
      zoneIdsWithSignal: [...result.zoneIdsWithSignal],
      report: result.report,
    };
    self.postMessage(response);
  } catch (err) {
    const response: ScannerWorkerResponse = {
      kind: 'error',
      message: (err as Error).message ?? String(err),
    };
    self.postMessage(response);
  }
};

// Экспортируем типы Candle5m / POIZone, чтобы Vite их подтянул в worker bundle.
export type { Candle5m, POIZone };
