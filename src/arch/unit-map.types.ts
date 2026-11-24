/** Пакет workspaces — единица выноса (D-108): каталог, имя и объявленные зависимости. */
export type Unit = {
  /** Абсолютный путь каталога с `package.json`. */
  readonly dir: string;
  readonly name: string;
  /** `dependencies` и `peerDependencies`: доступны и рабочему коду. */
  readonly working: ReadonlySet<string>;
  /** `devDependencies`: только тестовому коду (D-70). */
  readonly dev: ReadonlySet<string>;
};
