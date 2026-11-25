import type { GenLayoutSettings } from './layout';

/** Куда и в каком формате доставлять роли */
export type RoleTarget =
  | { dir: string; format: 'claude' | 'pi' }
  /** common — файл общего блока пакета для сборщика ролей проекта */
  | { dir: string; format: 'neutral'; common: string };

/**
 * Место слоя поставщика в проекте: каталог (у слоя по модулям — шаблон
 * с `{m}`); `package` — имя пакета workspaces над каталогом на `/src`.
 */
export type LayerPlace = { readonly dir: string; readonly package?: string };

/** Секция `skills`; нет поля — значение по умолчанию `CliConfig` */
export type SkillsSection = {
  readonly names?: readonly string[];
  readonly dirs?: readonly string[];
};

/** Секция `roles`; нет поля — значение по умолчанию `CliConfig` */
export type RolesSection = {
  readonly names?: readonly string[];
  readonly targets?: readonly RoleTarget[];
};

/** Разобранные секции конфига проекта — поля `ProjectConfig` */
export type ProjectSections = {
  readonly providers: readonly string[];
  readonly layers: Readonly<Record<string, LayerPlace>>;
  readonly gen: GenLayoutSettings;
  readonly skills?: SkillsSection;
  readonly roles?: RolesSection;
  readonly instructions?: string | null;
};
