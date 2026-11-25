import { GenLayout, type GenLayoutSettings } from '../gen/layout';
import { ProjectConfig, ProjectConfigError } from '../gen/project-config';
import type { RoleTarget } from '../gen/project-config.types';
import type { PackageSource } from './package-source';

/** Полные настройки доставки (`.dmg/config.json` со значениями по умолчанию) */
export interface CliSettings {
  skills: { names: string[]; dirs: string[] };
  roles: { names: string[]; targets: RoleTarget[] };
  /** Файл инструкций агентов для вставки; null — не вставлять */
  instructions: string | null;
  /** Раскладка модулей для `dmg-core gen` */
  gen: GenLayoutSettings;
}

/**
 * Настройки доставки по конфигу проекта: что взять из пакета и куда положить.
 * Форма конфига — `ProjectConfig`; здесь — смысл по пакету: у каждого поля
 * разумное значение по умолчанию (всё из пакета, Claude Code, `AGENTS.md`).
 */
export class CliConfig {
  constructor(private readonly pkg: PackageSource) {}

  /** Значения по умолчанию — их пишет `init` в новый конфиг */
  defaults(): CliSettings {
    return {
      skills: { names: [...this.pkg.skills.keys()], dirs: ['.claude/skills'] },
      roles: {
        names: this.pkg.roles.map((role) => role.name),
        targets: [{ dir: '.claude/agents', format: 'claude' }],
      },
      instructions: 'AGENTS.md',
      gen: { ...GenLayout.defaults },
    };
  }

  /** Конфиг поверх значений по умолчанию; нет скила или роли в пакете — `ProjectConfigError` */
  parse(config: ProjectConfig): CliSettings {
    const settings = this.defaults();
    const { skills, roles, instructions } = config;
    if (skills?.names) settings.skills.names = [...skills.names];
    if (skills?.dirs) settings.skills.dirs = [...skills.dirs];
    for (const name of settings.skills.names) {
      if (!this.pkg.skills.has(name)) this.fail(`нет скила «${name}» в пакете`);
    }

    if (roles?.names) settings.roles.names = [...roles.names];
    if (roles?.targets) settings.roles.targets = [...roles.targets];
    const roleNames = new Set(this.pkg.roles.map((role) => role.name));
    for (const name of settings.roles.names) {
      if (!roleNames.has(name)) this.fail(`нет роли «${name}» в пакете`);
    }

    if (instructions !== undefined) settings.instructions = instructions;
    settings.gen = { ...config.gen };
    return settings;
  }

  private fail(message: string): never {
    throw new ProjectConfigError(`${ProjectConfig.file}: ${message}`);
  }
}
