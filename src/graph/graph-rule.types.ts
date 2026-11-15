import type { Graph } from './graph';

/**
 * Правило поставщика над графом приложения (D-97). Возвращает сообщения без
 * ID: `ArchChecker` приписывает правилу `id`, чужой ID выдать нельзя.
 */
export type GraphRule = {
  /** ID правила: `<ПРЕФИКС>-<NN>` (ARC-13). */
  readonly id: string;
  check(graph: Graph): readonly string[];
};
