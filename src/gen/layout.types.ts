/** Пакет workspaces реализации модуля (`gen.package`). */
export type ModulePackage = {
  /** Каталог пакета реализации без `/src`. */
  readonly dir: string;
  /** Имя пакета модуля. */
  readonly name: string;
  /** Пакет домена — из `gen.domainImport` (`@acme/domain/{m}` → `@acme/domain`). */
  readonly domain: string;
  /** Путь от каталога пакета к корню проекта (`../..`) — для `extends` tsconfig. */
  readonly root: string;
};

/** Пакет workspaces слоя поставщика для модуля (`layers.<слой>.package`). */
export type LayerPackage = {
  /** Каталог пакета: место слоя без `/src`. */
  readonly dir: string;
  /** Имя пакета — шаблон `package` с подставленным `{m}`. */
  readonly name: string;
  /** Путь от каталога пакета к корню проекта (`../..`). */
  readonly root: string;
};
