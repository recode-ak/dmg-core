// Слой исходников для `arch:check` (D-107): тип порта поставщика графа, как
// `GraphRule`; ядро графа его не читает. Слои фреймворка — `FRAMEWORK_LAYERS`
// (`dmg-core/arch`), слои поставщика — `GraphProvider.layers()`.

/** Ось слоя: платформа (kernel, домен), реализации, раннеры. */
export type LayerAxis = 'platform' | 'implementation' | 'runner';

/** `public` — вход модуля для чужого кода (`ArchApp.entry`), `index` — `index.ts` или сам каталог. */
export type LayerEntry = 'public' | 'index';

/** Доступ к слою `layer`: через какие входы и под каким ID нарушение. */
export type LayerAccess = {
  readonly layer: string;
  /** Входы каталога модуля (или слоя не по модулям); нет — любой файл. */
  readonly entries?: readonly LayerEntry[];
  /** Входы своего модуля, когда оба слоя по модулям; нет — `entries`. */
  readonly own?: readonly LayerEntry[];
  /** Чужой модуль — только из `dependsOn` модуля импортёра. */
  readonly dependsOn?: boolean;
  /** ID нарушения доступа; нет — ID слоя-импортёра. */
  readonly rule?: string;
};

/** Слой исходников: что видит и кем виден; каталоги задаёт `ArchApp`. */
export type SourceLayer = {
  readonly name: string;
  readonly axis: LayerAxis;
  /** Каталоги слоя — шаблоны с `{m}`, по каталогу на модуль. */
  readonly perModule?: boolean;
  /** ID нарушения импорта из этого слоя. */
  readonly rule: string;
  readonly sees: readonly LayerAccess[];
  /** Кто ещё видит слой: только у слоя поставщика и только слои фреймворка. */
  readonly seenBy?: readonly LayerAccess[];
  /** У модуля есть вход `ArchApp.testing` только для тестового кода (D-70). */
  readonly testEntry?: boolean;
};
