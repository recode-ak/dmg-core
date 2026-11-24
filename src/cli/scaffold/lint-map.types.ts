/** Запрет импортов biome: глобы спецификаторов и сообщение с ID правила. */
export type ImportBan = {
  readonly group: readonly string[];
  readonly message: string;
};

/**
 * Строка карты линтера: правило (ID) → глобы biome от корня (`includes`,
 * тесты исключены всегда); проверка — плагин GritQL или `imports`. biome
 * не сливает `noRestrictedImports` пересекающихся секций, поэтому
 * `repeats` — ID строк выше, чьи запреты повторяются в этой секции.
 */
export type LintRule =
  | {
      readonly id: string;
      readonly includes: readonly string[];
      readonly plugin: string;
    }
  | {
      readonly id: string;
      readonly includes: readonly string[];
      readonly imports: readonly ImportBan[];
      readonly repeats?: readonly string[];
    };

/** Секция `overrides` biome.json — JSON-объект. */
export type BiomeOverride = Record<string, unknown>;

/** Каталоги слоёв профиля для карты линтера — глобы biome от корня проекта. */
export type LintDirs = {
  /** Исходники kernel приложения (D-106). */
  readonly kernel: string;
  /**
   * Спецификаторы входа kernel для белого списка домена — только сам вход,
   * без подпутей; относительный импорт kernel и так в белом списке.
   */
  readonly kernelImports: readonly string[];
  /** Исходники домена. */
  readonly domain: string;
  /** Прикладной слой и корень сборки (DOM-01, кроме `infra`). */
  readonly app: readonly string[];
  /** Исходники всех слоёв (ARC-09, CODE-02, операции и т.д.). */
  readonly sources: readonly string[];
  /** Точка входа раннера — единственное место чтения окружения (ARC-09). */
  readonly main: string;
};
