import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GenLayoutSettings } from './layout';
import type {
  LayerPlace,
  ProjectSections,
  RolesSection,
  RoleTarget,
  SkillsSection,
} from './project-config.types';

/** Ошибка конфига проекта: сообщение — пользователю, без стека и «Ошибка:». */
export class ProjectConfigError extends Error {}

type Json = Record<string, unknown>;

/** Прочие ключи верхнего уровня — отказ: опечатка не должна молча оставлять значение по умолчанию. */
const SECTIONS = [
  'providers',
  'layers',
  'skills',
  'roles',
  'instructions',
  'gen',
];

/** Ключи `gen`, которые понимает `GenLayout`; прочие — отказ, как у секций. */
const GEN_FIELDS = [
  'domain',
  'backend',
  'kernel',
  'domainImport',
  'package',
  'assembly',
  'appDef',
];

/** Переименованные ключи секции `gen` (D-106): ошибка с новым именем, без псевдонима. */
const RENAMED: Readonly<Record<string, string>> = {
  app: 'backend',
  compositionRoot: 'assembly',
};

const FORMATS: readonly RoleTarget['format'][] = ['neutral', 'claude', 'pi'];

/** Поставщик графа и слоёв, который подключён всегда — в `providers` не перечисляется. */
const CORE = 'dmg-core';

/** Суффикс каталога над пакетом workspaces. */
const SRC = '/src';

/**
 * Конфиг проекта `.dmg/config.json`: форма всех секций, строго на каждом
 * уровне; смысл по пакету (есть ли скил и роль) — у `CliConfig`. Прежний
 * `dmg-core.json` — отказ с подсказкой переноса, даже рядом с новым.
 * @see src/gen/project-config.test.ts
 */
export class ProjectConfig {
  static readonly dir = '.dmg';
  static readonly file = '.dmg/config.json';
  /** Документ графа `dmg-core graph` без `--out` */
  static readonly graphFile = '.dmg/graph.json';
  /** Прежнее имя конфига: переименован в `file`, найден — отказ */
  static readonly legacyFile = 'dmg-core.json';

  /** Раскладка без секции `gen` — профиль `single` (D-106) */
  static readonly genDefaults: GenLayoutSettings = {
    domain: 'src/platform/domain/{m}',
    backend: 'src/backend/{m}',
  };

  /** Поставщики графа и слоёв сверх dmg-core; нет — пусто */
  readonly providers: readonly string[];
  /** Места слоёв поставщиков по имени слоя; шаблоны `{m}` не раскрыты */
  readonly layers: Readonly<Record<string, LayerPlace>>;
  /** Раскладка модулей; нет секции — `genDefaults` */
  readonly gen: GenLayoutSettings;
  readonly skills?: SkillsSection;
  readonly roles?: RolesSection;
  /** Файл инструкций агентов для вставки; null — не вставлять */
  readonly instructions?: string | null;

  private constructor(sections: ProjectSections) {
    this.providers = sections.providers;
    this.layers = sections.layers;
    this.gen = sections.gen;
    this.skills = sections.skills;
    this.roles = sections.roles;
    this.instructions = sections.instructions;
  }

  /** Конфиг из корня проекта; нет файла — undefined; бросает `ProjectConfigError` */
  static async read(root: string): Promise<ProjectConfig | undefined> {
    const { file, legacyFile } = ProjectConfig;
    if (await Bun.file(join(root, legacyFile)).exists()) {
      throw new ProjectConfigError(
        `${legacyFile} переименован в ${file} — перенеси файл`,
      );
    }
    const text = await readFile(join(root, file), 'utf8').catch(
      () => undefined,
    );
    if (text === undefined) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return ProjectConfig.fail((error as Error).message);
    }
    return ProjectConfig.parse(json);
  }

  /** Разбирает форму конфига; бросает `ProjectConfigError` с полем */
  static parse(json: unknown): ProjectConfig {
    const data = ProjectConfig.object(json, 'конфиг');
    ProjectConfig.known(data, SECTIONS, '');
    return new ProjectConfig({
      skills: ProjectConfig.skills(data.skills),
      roles: ProjectConfig.roles(data.roles),
      instructions: ProjectConfig.instructions(data.instructions),
      gen: ProjectConfig.genSettings(data.gen),
      providers: ProjectConfig.providers(data.providers),
      layers: ProjectConfig.layers(data.layers),
    });
  }

  private static providers(json: unknown): readonly string[] {
    if (json === undefined) return [];
    if (
      !Array.isArray(json) ||
      json.some((item) => typeof item !== 'string' || item === '')
    ) {
      return ProjectConfig.fail('providers — массив непустых строк');
    }
    const names = json as string[];
    if (names.includes(CORE)) {
      ProjectConfig.fail(`providers — ${CORE} подключён всегда, не перечисляй`);
    }
    const repeat = names.find((name, i) => names.indexOf(name) !== i);
    if (repeat !== undefined) {
      ProjectConfig.fail(`providers — повтор «${repeat}»`);
    }
    return names;
  }

  private static layers(json: unknown): Record<string, LayerPlace> {
    if (json === undefined) return {};
    const data = ProjectConfig.object(json, 'layers');
    const layers: Record<string, LayerPlace> = {};
    for (const [name, value] of Object.entries(data)) {
      layers[name] = ProjectConfig.place(value, `layers.${name}`);
    }
    return layers;
  }

  /** Место слоя: `package` — только над каталогом на `/src`, `{m}` — парой с `dir` */
  private static place(json: unknown, field: string): LayerPlace {
    const data = ProjectConfig.object(json, field);
    ProjectConfig.known(data, ['dir', 'package'], `${field}.`);
    const { dir, package: name } = data;
    if (typeof dir !== 'string' || dir === '') {
      return ProjectConfig.fail(`${field}.dir — непустой путь каталога`);
    }
    if (name === undefined) return { dir };
    if (typeof name !== 'string' || name === '') {
      return ProjectConfig.fail(`${field}.package — непустое имя пакета`);
    }
    if (!dir.endsWith(SRC)) {
      ProjectConfig.fail(
        `${field}.package — ${field}.dir должен оканчиваться на ${SRC}`,
      );
    }
    if (name.includes('{m}') && !dir.includes('{m}')) {
      ProjectConfig.fail(
        `${field}.package — {m} только при {m} в ${field}.dir`,
      );
    }
    return { dir, package: name };
  }

  private static skills(json: unknown): SkillsSection | undefined {
    if (json === undefined) return undefined;
    const data = ProjectConfig.object(json, 'skills');
    ProjectConfig.known(data, ['names', 'dirs'], 'skills.');
    const skills: { names?: string[]; dirs?: string[] } = {};
    if (data.names !== undefined) {
      skills.names = ProjectConfig.strings(data.names, 'skills.names');
    }
    if (data.dirs !== undefined) {
      skills.dirs = ProjectConfig.strings(data.dirs, 'skills.dirs');
    }
    return skills;
  }

  private static roles(json: unknown): RolesSection | undefined {
    if (json === undefined) return undefined;
    const data = ProjectConfig.object(json, 'roles');
    ProjectConfig.known(data, ['names', 'targets'], 'roles.');
    const roles: { names?: string[]; targets?: RoleTarget[] } = {};
    if (data.names !== undefined) {
      roles.names = ProjectConfig.strings(data.names, 'roles.names');
    }
    if (data.targets !== undefined) {
      if (!Array.isArray(data.targets)) {
        ProjectConfig.fail('roles.targets — массив целей');
      }
      roles.targets = (data.targets as unknown[]).map((item, i) =>
        ProjectConfig.target(item, `roles.targets[${i}]`),
      );
    }
    return roles;
  }

  private static target(json: unknown, field: string): RoleTarget {
    const data = ProjectConfig.object(json, field);
    ProjectConfig.known(data, ['dir', 'format', 'common'], `${field}.`);
    if (typeof data.dir !== 'string') {
      ProjectConfig.fail(`${field}.dir — каталог ролей`);
    }
    const dir = data.dir as string;
    if (!FORMATS.includes(data.format as RoleTarget['format'])) {
      ProjectConfig.fail(`${field}.format — neutral, claude или pi`);
    }
    if (data.format !== 'neutral') {
      return { dir, format: data.format as 'claude' | 'pi' };
    }
    if (typeof data.common !== 'string') {
      ProjectConfig.fail(`${field}.common — путь общего блока для neutral`);
    }
    return { dir, format: 'neutral', common: data.common as string };
  }

  private static instructions(json: unknown): string | null | undefined {
    if (json !== undefined && json !== null && typeof json !== 'string') {
      ProjectConfig.fail('instructions — путь файла или null');
    }
    return json as string | null | undefined;
  }

  /** Секция `gen`: шаблоны с `{m}` поверх значений по умолчанию */
  private static genSettings(json: unknown): GenLayoutSettings {
    if (json === undefined) return { ...ProjectConfig.genDefaults };
    const data = ProjectConfig.object(json, 'gen');
    for (const [old, renamed] of Object.entries(RENAMED)) {
      if (Object.hasOwn(data, old)) {
        ProjectConfig.fail(`gen.${old} переименован в gen.${renamed}`);
      }
    }
    ProjectConfig.known(data, GEN_FIELDS, 'gen.');
    const gen = { ...ProjectConfig.genDefaults };
    for (const key of ['domain', 'backend'] as const) {
      const value = data[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.includes('{m}')) {
        ProjectConfig.fail(`gen.${key} — шаблон пути с {m}`);
      }
      gen[key] = value as string;
    }
    if (data.domainImport !== undefined) {
      const value = data.domainImport;
      if (typeof value !== 'string' || !value.includes('{m}')) {
        ProjectConfig.fail('gen.domainImport — шаблон с {m}');
      }
      gen.domainImport = value as string;
    }
    for (const key of ['assembly', 'kernel'] as const) {
      const value = data[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.includes('{m}')) {
        ProjectConfig.fail(`gen.${key} — путь каталога без {m}`);
      }
      gen[key] = value as string;
    }
    if (data.appDef !== undefined) {
      const value = data.appDef;
      if (typeof value !== 'string' || value.includes('{m}')) {
        ProjectConfig.fail('gen.appDef — путь файла без {m}');
      }
      gen.appDef = value as string;
    }
    if (data.package !== undefined) {
      const value = data.package;
      if (typeof value !== 'string' || !value.includes('{m}')) {
        ProjectConfig.fail('gen.package — шаблон имени пакета с {m}');
      }
      if (!gen.backend.endsWith(SRC)) {
        ProjectConfig.fail(
          `gen.package — gen.backend должен оканчиваться на ${SRC}`,
        );
      }
      if (gen.domainImport === undefined) {
        ProjectConfig.fail('gen.package — нужен gen.domainImport');
      }
      gen.package = value as string;
    }
    return gen;
  }

  private static object(json: unknown, field: string): Json {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return ProjectConfig.fail(`${field} — объект`);
    }
    return json as Json;
  }

  private static known(data: Json, keys: string[], prefix: string): void {
    for (const key of Object.keys(data)) {
      if (!keys.includes(key)) {
        ProjectConfig.fail(`неизвестное поле «${prefix}${key}»`);
      }
    }
  }

  private static strings(json: unknown, field: string): string[] {
    if (!Array.isArray(json) || json.some((item) => typeof item !== 'string')) {
      ProjectConfig.fail(`${field} — массив строк`);
    }
    return json as string[];
  }

  private static fail(message: string): never {
    throw new ProjectConfigError(`${ProjectConfig.file}: ${message}`);
  }
}
