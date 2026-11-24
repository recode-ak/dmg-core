import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { ModuleLayout } from '../arch/file-checker';
import type { ModulePackage } from './layout.types';

/** Раскладка проекта для генераторов (`dmg-core.json`, `gen`); `{m}` — имя модуля */
export interface GenLayoutSettings {
  /** Каталог модуля домена */
  domain: string;
  /** Каталог реализации модуля */
  backend: string;
  /** Спецификатор импорта домена из реализации; нет — относительный путь */
  domainImport?: string;
  /**
   * Имя пакета модуля (`@acme/{m}`): задан — `gen module` создаёт пакет
   * workspaces над каталогом реализации (`backend` оканчивается на
   * `/src`); нужен `domainImport` — по нему зависимость на пакет домена.
   */
  package?: string;
  /**
   * Каталог сборки (`app.ts`, D-50) — без `{m}`: `gen module` и
   * `gen aggregate` подключают модуль по маркерам его `app.ts`; при
   * `gen.package` и пути на `/src` — ещё зависимость в `package.json` пакета.
   */
  assembly?: string;
  /** Каталог kernel — общего для домена и слоёв над ним, без `{m}` */
  kernel?: string;
  /**
   * Файл `AppDef` проекта (`<домен>/<имя>.app.ts`) — без `{m}`: `gen module`
   * вписывает Def модуля в его `modules` по маркерам файла. Значения по
   * умолчанию нет — имя приложения генератору неизвестно.
   */
  appDef?: string;
}

/** Поля секции `gen`. */
const FIELDS = [
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

/** Ключи-каталоги без `{m}`; не заданы — значение только при раскладке по умолчанию. */
type DirKey = 'assembly' | 'kernel';

/** Суффикс каталога реализации в пакете модуля. */
const SRC = '/src';

/**
 * Где генератор создаёт файлы модуля и как реализация импортирует домен
 * (D-106): из настроек, по умолчанию — `single`, `src/platform/domain/{m}`,
 * `src/backend/{m}`. Гибки только корни: форма внутри модуля фиксирована
 * (MAN-10, ARC-06). Один источник путей для `gen` и `ArchApp.layout`.
 */
export class GenLayout {
  /** Файл настроек проекта; раскладка — его секция `gen` */
  static readonly configFile = 'dmg-core.json';

  static readonly defaults: GenLayoutSettings = {
    domain: 'src/platform/domain/{m}',
    backend: 'src/backend/{m}',
  };

  /**
   * Сборка по умолчанию — только при раскладке по умолчанию: при своей
   * раскладке без `gen.assembly` она неизвестна, и генератор не подключает
   * модуль сам, а печатает общую подсказку.
   */
  static readonly defaultAssembly = 'src/runners/assembly';

  /** Kernel по умолчанию — как сборка, только при раскладке по умолчанию */
  static readonly defaultKernel = 'src/platform/kernel';

  /** Раскладка проекта из `dmg-core.json`; нет файла или секции — по умолчанию */
  static async read(root: string): Promise<GenLayout> {
    const text = await readFile(join(root, GenLayout.configFile), 'utf8').catch(
      () => undefined,
    );
    const gen = text === undefined ? undefined : JSON.parse(text).gen;
    const settings =
      gen === undefined
        ? { ...GenLayout.defaults }
        : GenLayout.settingsFrom(gen);
    return new GenLayout(settings, root);
  }

  /** Секция `gen`: шаблоны с `{m}` поверх значений по умолчанию; бросает Error с полем */
  static settingsFrom(json: unknown): GenLayoutSettings {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return GenLayout.fail('gen — объект');
    }
    const data = json as Record<string, unknown>;
    for (const [old, renamed] of Object.entries(RENAMED)) {
      if (Object.hasOwn(data, old)) {
        GenLayout.fail(`gen.${old} переименован в gen.${renamed}`);
      }
    }
    for (const key of Object.keys(data)) {
      if (!FIELDS.includes(key)) {
        GenLayout.fail(`неизвестное поле «gen.${key}»`);
      }
    }
    const gen = { ...GenLayout.defaults };
    for (const key of ['domain', 'backend'] as const) {
      const value = data[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value.includes('{m}')) {
        GenLayout.fail(`gen.${key} — шаблон пути с {m}`);
      }
      gen[key] = value as string;
    }
    if (data.domainImport !== undefined) {
      const value = data.domainImport;
      if (typeof value !== 'string' || !value.includes('{m}')) {
        GenLayout.fail('gen.domainImport — шаблон с {m}');
      }
      gen.domainImport = value as string;
    }
    for (const key of ['assembly', 'kernel'] as const) {
      const value = data[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.includes('{m}')) {
        GenLayout.fail(`gen.${key} — путь каталога без {m}`);
      }
      gen[key] = value as string;
    }
    if (data.appDef !== undefined) {
      const value = data.appDef;
      if (typeof value !== 'string' || value.includes('{m}')) {
        GenLayout.fail('gen.appDef — путь файла без {m}');
      }
      gen.appDef = value as string;
    }
    if (data.package !== undefined) {
      const value = data.package;
      if (typeof value !== 'string' || !value.includes('{m}')) {
        GenLayout.fail('gen.package — шаблон имени пакета с {m}');
      }
      if (!gen.backend.endsWith(SRC)) {
        GenLayout.fail(
          `gen.package — gen.backend должен оканчиваться на ${SRC}`,
        );
      }
      if (gen.domainImport === undefined) {
        GenLayout.fail('gen.package — нужен gen.domainImport');
      }
      gen.package = value as string;
    }
    return gen;
  }

  private static fail(message: string): never {
    throw new Error(`${GenLayout.configFile}: ${message}`);
  }

  /** root — корень проекта; «.» оставляет пути относительными */
  constructor(
    private readonly settings: GenLayoutSettings,
    private readonly root: string,
  ) {}

  domainDir(module: string): string {
    return this.path(this.settings.domain, module);
  }

  backendDir(module: string): string {
    return this.path(this.settings.backend, module);
  }

  /** Домен и реализация модуля — значение `ArchApp.layout` */
  module(module: string): ModuleLayout {
    return { domain: this.domainDir(module), backend: this.backendDir(module) };
  }

  /**
   * Каталог сборки (`gen.assembly`); не задан — `src/runners/assembly` при
   * раскладке по умолчанию, иначе undefined
   */
  assemblyDir(): string | undefined {
    return this.dirOf('assembly');
  }

  /**
   * Каталог kernel (`gen.kernel`); не задан — `src/platform/kernel` при
   * раскладке по умолчанию, иначе undefined
   */
  kernelDir(): string | undefined {
    return this.dirOf('kernel');
  }

  private dirOf(key: DirKey): string | undefined {
    const dir = this.dirSetting(key);
    return dir === undefined ? undefined : this.path(dir, '');
  }

  /** Своя раскладка без ключа — каталог неизвестен: не угадываем */
  private dirSetting(key: DirKey): string | undefined {
    const value = this.settings[key];
    if (value !== undefined) return value;
    const { domain, backend } = this.settings;
    const { defaults } = GenLayout;
    if (domain !== defaults.domain || backend !== defaults.backend) {
      return undefined;
    }
    return key === 'assembly'
      ? GenLayout.defaultAssembly
      : GenLayout.defaultKernel;
  }

  /**
   * `package.json` пакета сборки: каталог сборки оканчивается на `/src`,
   * а модули — пакеты (`gen.package`); иначе undefined
   */
  assemblyPackage(): string | undefined {
    const dir = this.assemblyDir();
    if (
      dir === undefined ||
      this.settings.package === undefined ||
      !dir.endsWith(SRC)
    ) {
      return undefined;
    }
    return join(dir.slice(0, -SRC.length), 'package.json');
  }

  /** Файл `AppDef` (`gen.appDef`); не задан — undefined */
  appDefFile(): string | undefined {
    const { appDef } = this.settings;
    return appDef === undefined ? undefined : this.path(appDef, '');
  }

  /** Пакет реализации модуля; нет `gen.package` — undefined */
  package(module: string): ModulePackage | undefined {
    const { package: name, domainImport } = this.settings;
    if (name === undefined || domainImport === undefined) return undefined;
    const dir = this.backendDir(module).slice(0, -SRC.length);
    const domain = this.fill(domainImport, module).split('/');
    return {
      dir,
      name: this.fill(name, module),
      domain: domain.slice(0, domain[0]?.startsWith('@') ? 2 : 1).join('/'),
      root: relative(dir, this.root).split(sep).join('/'),
    };
  }

  /** Применяемая раскладка одной строкой — первая строка вывода `gen` */
  describe(): string {
    const { domain, backend, domainImport, package: name } = this.settings;
    const line = `Раскладка: домен — ${domain}, реализация — ${backend}, импорт домена — ${domainImport ?? 'относительный'}`;
    const withPackage =
      name === undefined ? line : `${line}, пакет модуля — ${name}`;
    const assembly = this.dirSetting('assembly') ?? 'не задана (gen.assembly)';
    const kernel = this.dirSetting('kernel') ?? 'не задан (gen.kernel)';
    const appDef = this.settings.appDef ?? 'не задан (gen.appDef)';
    return `${withPackage}, сборка — ${assembly}, kernel — ${kernel}, манифест приложения — ${appDef}`;
  }

  /** Импорт домена по шаблону (`gen.domainImport`), а не относительный */
  hasDomainImport(): boolean {
    return this.settings.domainImport !== undefined;
  }

  /** Спецификатор импорта домена модуля из файла в каталоге fromDir */
  domainImport(module: string, fromDir: string): string {
    if (this.settings.domainImport !== undefined) {
      return this.fill(this.settings.domainImport, module);
    }
    const path = relative(fromDir, this.domainDir(module)).split(sep).join('/');
    return path.startsWith('.') ? path : `./${path}`;
  }

  private path(template: string, module: string): string {
    const path = this.fill(template, module);
    return isAbsolute(path) ? path : join(this.root, path);
  }

  private fill(template: string, module: string): string {
    return template.replaceAll('{m}', module);
  }
}
