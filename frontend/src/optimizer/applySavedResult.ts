/**
 * Чистая функция «применить SavedResult» — восстанавливает все исходные
 * условия прогона: TF-пара, SMC-параметры, BT-параметры, tickMultiplier.
 *
 * Вынесена из OptimizerPanel.tsx чтобы быть тестируемой без jsdom.
 * Порядок вызовов важен (см. комментарий внутри).
 */

import type { BacktestSettings } from '@/backtest/types';
import type { SmcLayers, SmcOptions } from '@/engine/smc/types';
import type { TfPairId } from '@/types';
import type { SavedResult } from './savedResults';

export interface ApplySavedDeps {
  baseSettings: BacktestSettings;
  baseSmcOpts: SmcOptions;
  /** Текущая TF-пара. Применяем новую только если отличается. */
  currentTfPairId: TfPairId;
  onApply: (next: BacktestSettings) => void;
  onApplySmc: (next: SmcOptions) => void;
  onApplyMultiplier?: ((mult: 1 | 2 | 5 | 10 | undefined) => void) | undefined;
  onApplyTfPair?: ((tfPairId: TfPairId) => void) | undefined;
  /**
   * Применить SMC-слои (toggle-флаги fvg/liq/structure/orderBlocks/...) —
   * критично, иначе overlay считается с НЕ ТЕМИ детекторами чем когда
   * saved создавался → разные зоны → разные сделки. Optional: legacy
   * saved до 1.39.2 не имеют поля.
   */
  onApplySmcLayers?: ((layers: SmcLayers) => void) | undefined;
}

/**
 * Применяет SavedResult к текущему состоянию приложения.
 *
 * Порядок (важен):
 *   1) TF-пара (если задана в saved и отличается) — триггерит сброс
 *      signals/viewport в App, поэтому идёт ПЕРВОЙ, иначе перерисовка
 *      затрёт только что выставленные BT/SMC параметры.
 *   2) SMC-слои (toggle-флаги детекторов) — без них SMC-overlay считается
 *      с НЕПРАВИЛЬНЫМ набором детекторов и сделки будут другими.
 *   3) SMC-опции (merge с baseSmcOpts чтобы сохранить hideMitigated и пр.)
 *   4) BT-настройки (merge с baseSettings)
 *   5) tickMultiplier — если задан и есть колбэк.
 *
 * Symbol намеренно НЕ восстанавливается: переключение тикера это
 * heavyweight операция (перезагрузка данных, рестарт live-стрима, новые
 * зоны), требует явного согласия пользователя. «Источник»-колонка в
 * Saved-таблице визуально показывает символ — пользователь сам решает.
 */
export function applySavedResult(saved: SavedResult, deps: ApplySavedDeps): void {
  if (deps.onApplyTfPair && saved.tfPairId && saved.tfPairId !== deps.currentTfPairId) {
    deps.onApplyTfPair(saved.tfPairId);
  }
  if (deps.onApplySmcLayers && saved.smcLayers) {
    deps.onApplySmcLayers(saved.smcLayers);
  }
  deps.onApplySmc({ ...deps.baseSmcOpts, ...saved.smcParams });
  deps.onApply({ ...deps.baseSettings, ...saved.btParams });
  if (deps.onApplyMultiplier && saved.dataParams.tickMultiplier !== undefined) {
    deps.onApplyMultiplier(saved.dataParams.tickMultiplier as 1 | 2 | 5 | 10);
  }
}
