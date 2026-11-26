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
  /** Роль → пути файлов знаний проекта от корня, в порядке конфига */
  readonly refs?: ReadonlyMap<string, readonly string[]>;
};

/** Бюджеты секции `docs`: строки по видам документа и знаки подписи (`docs-format.md` § 1, § 3) */
export type DocsLimits = {
  readonly entry: number;
  readonly index: number;
  readonly leaf: number;
  readonly caption: number;
};

/** Исключение из проверок вида: путь файла или каталога (с `/`) и причина */
export type DocsExempt = {
  readonly path: string;
  readonly reason: string;
};

/** Секция `docs`; нет поля — значение по умолчанию `DocsSettings` */
export type DocsSection = {
  readonly entries?: readonly string[];
  readonly exempt?: readonly DocsExempt[];
  readonly generated?: readonly string[];
  readonly limits?: Partial<DocsLimits>;
};

/** Разобранные секции конфига проекта — поля `ProjectConfig` */
export type ProjectSections = {
  readonly providers: readonly string[];
  readonly layers: Readonly<Record<string, LayerPlace>>;
  readonly gen: GenLayoutSettings;
  readonly skills?: SkillsSection;
  readonly roles?: RolesSection;
  readonly instructions?: string | null;
  readonly docs?: DocsSection;
};
