/** Исходный файл проверки: путь от корня репо через `/` и текст. */
export type SourceFile = { readonly path: string; readonly text: string };

/** Тексты реестров долга: кода, тестов (`T-DEBT`), продукта (`D-DEBT`). */
export type DebtRegistries = {
  readonly code?: string;
  readonly tests?: string;
  readonly product?: string;
};

/** Пути реестров от корня репо — для сообщений и чтения с диска. */
export type DebtRegistryPaths = {
  readonly code: string;
  readonly tests?: string;
  readonly product?: string;
};

/**
 * Настройка проверки: префикс ID долга кода (`DEBT` — пакет, `C-DEBT` —
 * проект), glob'ы файлов без проверки маркеров временности, пути реестров
 * для сообщений (без них — имена реестров `code`, `tests`, `product`).
 */
export type DebtCheckerOptions = {
  readonly idPrefix: string;
  readonly tempMarkers?: { readonly skip: readonly string[] };
  readonly registryPaths?: DebtRegistryPaths;
};

/**
 * Вход проверки: исходники (Признак, ID в коде, маркеры временности), все
 * пути файлов репо (Файлы записей `T-DEBT`), тексты реестров и пути
 * реестров раскладки, которых нет на диске.
 */
export type DebtInput = {
  readonly code: readonly SourceFile[];
  readonly files: readonly string[];
  readonly registries: DebtRegistries;
  readonly missing?: readonly string[];
};

/** Где лежат исходники проверки (glob'ы и исключения) и реестры. */
export type DebtLayout = {
  readonly code: readonly string[];
  readonly exclude?: readonly string[];
  readonly registries: DebtRegistryPaths;
};

/** Запись реестра: ID и поля — токены в бэктиках строки поля и её пунктов. */
export type DebtEntry = {
  readonly id: string;
  readonly fields: Map<string, string[]>;
};
