import type { SourceLayer } from '../graph/source-layer.types';

/**
 * Модуль каталога слоя (D-110): модуль `AppDef` или модуль поставщика — только
 * имя, без `external` (D-37) и `dependsOn`. `own` и `entries` сверяют по имени.
 */
export type LayerModule = {
  readonly name: string;
  readonly external?: boolean;
  readonly dependsOn?: readonly { readonly name: string }[];
};

/** Каталог слоя: у слоя по модулям — каталог модуля или корень слоя (без `module`). */
export type LayerPlace = {
  readonly layer: SourceLayer;
  /** Абсолютный путь каталога. */
  readonly dir: string;
  readonly module?: LayerModule;
  /** Реализации нет в приложении (D-37): файлы не обходятся, вход не проверяется. */
  readonly foreign: boolean;
};

/** Шаблон каталога слоя по модулям: корень до сегмента с `{m}` и этот сегмент регуляркой. */
export type LayerTemplate = {
  readonly layer: string;
  readonly root: string;
  readonly segment: RegExp;
};
