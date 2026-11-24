import type { AnyModuleDef } from '../domain/contracts/module-def';
import type { SourceLayer } from '../graph/source-layer.types';

/** Каталог слоя: у слоя по модулям — каталог модуля или корень слоя (без `module`). */
export type LayerPlace = {
  readonly layer: SourceLayer;
  /** Абсолютный путь каталога. */
  readonly dir: string;
  readonly module?: AnyModuleDef;
  /** Реализации нет в приложении (D-37): файлы не обходятся, вход не проверяется. */
  readonly foreign: boolean;
};
