// Слой исходников для `arch:check` (D-107): тип порта поставщика графа, как
// `GraphRule`; ядро графа его не читает. Слои фреймворка — `FRAMEWORK_LAYERS`
// (`dmg-core/arch`), слои поставщика — `GraphProvider.layers()`.

/** Ось слоя: платформа приложения (kernel, домен), реализации, раннеры. */
export type LayerAxis = 'platform' | 'implementation' | 'runner';

/**
 * `public` — вход модуля для чужого кода (`entry` слоя-цели, без него —
 * `ArchApp.entry`), `index` — `index.ts` или сам каталог.
 */
export type LayerEntry = 'public' | 'index';

/**
 * Какие чужие модули слоя-цели видны (D-110): `none` — только свой модуль,
 * `dependsOn` — только из `dependsOn` модуля импортёра; оба слоя — по модулям.
 */
export type LayerOthers = 'none' | 'dependsOn';

/** Доступ к слою `layer`: через какие входы и под каким ID нарушение. */
export type LayerAccess = {
  readonly layer: string;
  /** Входы каталога модуля (или слоя не по модулям); нет — любой файл. */
  readonly entries?: readonly LayerEntry[];
  /** Входы своего модуля, когда оба слоя по модулям; нет — `entries`, при `others: 'none'` — любой файл. */
  readonly own?: readonly LayerEntry[];
  /** Нет — любой чужой модуль через `entries`; при `none` `entries` не задаются (ARC-13). */
  readonly others?: LayerOthers;
  /** ID нарушения доступа; нет — ID слоя-импортёра. */
  readonly rule?: string;
  /** Нарушение доступа снимается записью долга (ARC-12, D-111); нужен свой `rule`. */
  readonly debt?: true;
};

/** Слой исходников: что видит и кем виден; каталоги задаёт `ArchApp`. */
export type SourceLayer = {
  readonly name: string;
  readonly axis: LayerAxis;
  /**
   * Каталоги слоя — шаблоны с `{m}`, по каталогу на модуль (D-110): `true` —
   * модули `AppDef`, список — имена модулей поставщика.
   */
  readonly perModule?: true | readonly string[];
  /** Вход модуля слоя для чужого кода (`public`) — имя файла без расширения; нет — `ArchApp.entry`. */
  readonly entry?: string;
  /** ID нарушения импорта из этого слоя. */
  readonly rule: string;
  readonly sees: readonly LayerAccess[];
  /** Кто ещё видит слой: только у слоя поставщика и только слои фреймворка. */
  readonly seenBy?: readonly LayerAccess[];
  /** У модуля есть вход `ArchApp.testing` только для тестового кода (D-70). */
  readonly testEntry?: boolean;
};
