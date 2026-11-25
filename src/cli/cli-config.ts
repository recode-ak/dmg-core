import { GenLayout, type GenLayoutSettings } from '../gen/layout';
import { ProjectConfig, ProjectConfigError } from '../gen/project-config';
import type { RoleTarget } from '../gen/project-config.types';
import type { PackageSet } from './package-set';

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
 * Настройки доставки по конфигу проекта: что взять из поставки и куда положить.
 * Форма конфига — `ProjectConfig`; здесь — смысл по объединению `dmg-core` и
 * поставщиков: у каждого поля разумное значение по умолчанию (всё из
 * поставки, Claude Code, `AGENTS.md`).
 */
export class CliConfig {
  constructor(private readonly packages: PackageSet) {}

  /** Значения по умолчанию — их пишет `init` в новый конфиг */
  defaults(): CliSettings {
    return {
      skills: { names: this.packages.skillNames(), dirs: ['.claude/skills'] },
      roles: {
        names: this.packages.roleNames(),
        targets: [{ dir: '.claude/agents', format: 'claude' }],
      },
      instructions: 'AGENTS.md',
      gen: { ...GenLayout.defaults },
    };
  }

  /** Конфиг поверх значений по умолчанию; нет скила или роли в поставке — `ProjectConfigError` */
  parse(config: ProjectConfig): CliSettings {
    const settings = this.defaults();
    const { skills, roles, instructions } = config;
    if (skills?.names) settings.skills.names = [...skills.names];
    if (skills?.dirs) settings.skills.dirs = [...skills.dirs];
    for (const name of settings.skills.names) {
      if (!this.packages.skill(name)) this.fail(`нет скила «${name}» в пакете`);
    }

    if (roles?.names) settings.roles.names = [...roles.names];
    if (roles?.targets) settings.roles.targets = [...roles.targets];
    for (const name of settings.roles.names) {
      if (!this.packages.role(name)) this.fail(`нет роли «${name}» в пакете`);
    }

    if (instructions !== undefined) settings.instructions = instructions;
    settings.gen = { ...config.gen };
    return settings;
  }

  private fail(message: string): never {
    throw new ProjectConfigError(`${ProjectConfig.file}: ${message}`);
  }
}
