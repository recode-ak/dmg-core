import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { GenLayoutSettings } from './layout';
import type {
  DocsExempt,
  DocsLimits,
  DocsSection,
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
  'docs',
];

/** Ключи секции `docs` и её бюджетов (`docs-format.md` § 7). */
const DOCS_FIELDS = ['entries', 'exempt', 'generated', 'limits'];
const DOCS_LIMITS: readonly (keyof DocsLimits)[] = [
  'entry',
  'index',
  'leaf',
  'caption',
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

/** Знаки, которым не место в пути из промпта: служебные и разделители Unicode, бэктик. */
const UNSAFE = /[\p{C}\p{Z}`]/u;

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
  /** Дерево документации для `docs --check`; нет — умолчания `DocsSettings` */
  readonly docs?: DocsSection;

  private constructor(sections: ProjectSections) {
    this.providers = sections.providers;
    this.layers = sections.layers;
    this.gen = sections.gen;
    this.skills = sections.skills;
    this.roles = sections.roles;
    this.instructions = sections.instructions;
    this.docs = sections.docs;
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
      docs: ProjectConfig.docsSection(data.docs),
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
    ProjectConfig.known(data, ['names', 'targets', 'refs'], 'roles.');
    const roles: {
      names?: string[];
      targets?: RoleTarget[];
      refs?: ReadonlyMap<string, readonly string[]>;
    } = {};
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
    if (data.refs !== undefined) roles.refs = ProjectConfig.refs(data.refs);
    return roles;
  }

  /**
   * `roles.refs`: роль → пути файлов знаний. `Object.entries` в `Map`, а не
   * присваивание в `{}`: ключ `__proto__` из `JSON.parse` не теряется.
   */
  private static refs(json: unknown): ReadonlyMap<string, readonly string[]> {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return ProjectConfig.fail('roles.refs — объект «роль → список путей»');
    }
    const refs = new Map<string, readonly string[]>();
    for (const [role, value] of Object.entries(json)) {
      const field = `roles.refs.${role}`;
      if (!Array.isArray(value) || value.length === 0) {
        ProjectConfig.fail(
          `${field} — непустой массив путей (нет ссылок — убери ключ)`,
        );
      }
      const paths = ProjectConfig.paths(value as unknown[], field);
      paths.forEach((path, i) => {
        const problem = ProjectConfig.refProblem(path);
        if (problem) ProjectConfig.fail(`${field}[${i}] — ${problem}`);
        if (paths.indexOf(path) !== i) {
          ProjectConfig.fail(`${field}[${i}] — путь повторяется: ${path}`);
        }
      });
      refs.set(role, paths);
    }
    return refs;
  }

  /**
   * Сверх `pathProblem`: ссылка — файл целиком, путь безопасен для текста
   * промпта — без управляющих, невидимых и пробельных знаков, кроме пробела.
   */
  private static refProblem(path: string): string | undefined {
    if (path === '.') return 'файл, не каталог: это корень проекта';
    if (path.endsWith('/')) return 'файл, не каталог (убери «/» в конце)';
    if (path.includes('#')) return 'без якоря: лист целиком (DOC-03)';
    if (UNSAFE.test(path.replaceAll(' ', ''))) {
      return 'без управляющих знаков и «`» (путь попадает в промпт)';
    }
    return undefined;
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

  /** Секция `docs`: форма и пути внутри корня; умолчания — у `DocsSettings` */
  private static docsSection(json: unknown): DocsSection | undefined {
    if (json === undefined) return undefined;
    const data = ProjectConfig.object(json, 'docs');
    ProjectConfig.known(data, DOCS_FIELDS, 'docs.');
    const docs: {
      entries?: string[];
      exempt?: DocsExempt[];
      generated?: string[];
      limits?: Partial<DocsLimits>;
    } = {};
    if (data.entries !== undefined) {
      if (!Array.isArray(data.entries) || data.entries.length === 0) {
        ProjectConfig.fail('docs.entries — непустой массив путей входов');
      }
      const entries = ProjectConfig.paths(data.entries, 'docs.entries');
      const repeat = entries.findIndex(
        (entry, i) => entries.indexOf(entry) !== i,
      );
      if (repeat !== -1) {
        ProjectConfig.fail(
          `docs.entries[${repeat}] — повтор «${entries[repeat]}»`,
        );
      }
      docs.entries = entries;
    }
    if (data.exempt !== undefined) {
      if (!Array.isArray(data.exempt)) {
        ProjectConfig.fail('docs.exempt — массив исключений { path, reason }');
      }
      docs.exempt = (data.exempt as unknown[]).map((item, i) =>
        ProjectConfig.exempt(item, `docs.exempt[${i}]`),
      );
    }
    if (data.generated !== undefined) {
      if (!Array.isArray(data.generated)) {
        ProjectConfig.fail('docs.generated — массив путей');
      }
      docs.generated = ProjectConfig.paths(data.generated, 'docs.generated');
    }
    if (data.limits !== undefined) {
      const limits = ProjectConfig.object(data.limits, 'docs.limits');
      ProjectConfig.known(limits, [...DOCS_LIMITS], 'docs.limits.');
      const parsed: Record<string, number> = {};
      for (const key of DOCS_LIMITS) {
        const value = limits[key];
        if (value === undefined) continue;
        if (!Number.isInteger(value) || (value as number) <= 0) {
          ProjectConfig.fail(`docs.limits.${key} — целое число больше нуля`);
        }
        parsed[key] = value as number;
      }
      docs.limits = parsed;
    }
    return docs;
  }

  /** Исключение: путь внутри корня и причина (DOC-05) */
  private static exempt(json: unknown, field: string): DocsExempt {
    const data = ProjectConfig.object(json, field);
    ProjectConfig.known(data, ['path', 'reason'], `${field}.`);
    const { path, reason } = data;
    if (typeof path !== 'string' || path === '') {
      return ProjectConfig.fail(`${field}.path — путь файла или каталога`);
    }
    const place = ProjectConfig.pathProblem(path);
    if (place) ProjectConfig.fail(`${field}.path — ${place} (DOC-05)`);
    if (typeof reason !== 'string' || reason.trim() === '') {
      ProjectConfig.fail(
        `${field}.reason — исключение без причины не принимается (DOC-05)`,
      );
    }
    return { path, reason: reason as string };
  }

  /** Массив непустых путей от корня проекта: не абсолютных, без выхода за корень */
  private static paths(json: unknown[], field: string): string[] {
    json.forEach((item, i) => {
      if (typeof item !== 'string' || item === '') {
        ProjectConfig.fail(`${field}[${i}] — непустой путь`);
      }
      const place = ProjectConfig.pathProblem(item as string);
      if (place) ProjectConfig.fail(`${field}[${i}] — ${place}`);
    });
    return json as string[];
  }

  /**
   * Что не так с путём от корня проекта: абсолютный, выходит за корень или не
   * в нормальной форме (`./`, `//`, `..` внутри) — путь сравнивается с путями
   * обхода как строка. Путь в порядке — undefined.
   */
  private static pathProblem(path: string): string | undefined {
    if (posix.isAbsolute(path) || posix.normalize(path).startsWith('..')) {
      return 'путь внутри проекта, от его корня';
    }
    if (path.startsWith('./') || posix.normalize(path) !== path) {
      return `путь в нормальной форме: ${posix.normalize(path)}`;
    }
    return undefined;
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
