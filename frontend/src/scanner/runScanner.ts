/**
 * Прогон сканера по всем свечам внутри POI-зон.
 *
 * Алгоритм:
 *   для каждой зоны:
 *     для каждой 5m-свечи в [zone.startTime, zone.endTime] и пересекающей [minPrice, maxPrice]:
 *       если checkSignal вернул LONG/SHORT — добавляем в результат
 *
 * Сложность: O(N × M), где N = число свечей, M = число зон.
 * Для 1440 свечей и 5-10 зон — это микросекунды, но архитектурно
 * мы запускаем это в Web Worker, чтобы не блокировать UI при росте объёмов.
 */

import { checkSignal, candleInZone, buildDiagnostics } from './checkSignal';
import type { Candle5m, POIZone, ScannerReport, Signal } from '@/types';

export interface RunScannerArgs {
  candles: readonly Candle5m[];
  zones: readonly POIZone[];
}

export interface RunScannerResult {
  /** Один сигнал на свечу — там, где свеча сатисфирует все 4 правила. */
  signals: Signal[];
  /** Какие зоны имеют хотя бы один сигнал внутри (для подсветки). */
  zoneIdsWithSignal: Set<string>;
  report: ScannerReport;
}

export function runScanner({ candles, zones }: RunScannerArgs): RunScannerResult {
  const signals: Signal[] = [];
  const zoneIdsWithSignal = new Set<string>();

  // Пробежимся по зонам внешним циклом — это позволит линейно отвалиться
  // на свечах за пределами временного окна зоны (а зон обычно мало).
  for (const zone of zones) {
    for (const candle of candles) {
      if (!candleInZone(candle, zone)) continue;

      const check = checkSignal(candle);
      if (check.type === null) continue;

      // ID детерминирован: zoneId + timestamp + type. Это удобно для:
      //   1) сохранения выбранного сигнала между перезапусками сканера
      //   2) отладки в DevTools («какой именно сигнал я выбрал»)
      //   3) уникальности — на одну свечу одно направление сигнала.
      const id = `${zone.id}::${candle.timestamp}::${check.type}`;

      signals.push({
        id,
        candleTime: candle.timestamp,
        type: check.type,
        price: check.type === 'LONG' ? candle.low : candle.high,
        zoneId: zone.id,
        // Бонус-индикаторы (имбалансы / нуль на экстремуме) зависят от направления —
        // передаём type в диагностику.
        diagnostics: buildDiagnostics(candle, check.type),
      });
      zoneIdsWithSignal.add(zone.id);
    }
  }

  let longCount = 0;
  let shortCount = 0;
  for (const s of signals) {
    if (s.type === 'LONG') longCount++;
    else shortCount++;
  }

  const report: ScannerReport = {
    zonesTotal: zones.length,
    zonesWithSignal: zoneIdsWithSignal.size,
    signalsTotal: signals.length,
    longCount,
    shortCount,
  };

  return { signals, zoneIdsWithSignal, report };
}
