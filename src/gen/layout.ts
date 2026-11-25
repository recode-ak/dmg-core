import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FrameworkDirs } from '../arch/layer-checker.types';
import { GenError } from './gen-error';
import type { LayerPackage, ModulePackage } from './layout.types';
import { ProjectConfig, ProjectConfigError } from './project-config';
import type { LayerPlace } from './project-config.types';

/** Раскладка проекта для генераторов (`.dmg/config.json`, `gen`); `{m}` — имя модуля */
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
  /** Прежняя точка входа значений по умолчанию (каркас, `CliConfig`); источник — `ProjectConfig` */
  static readonly defaults: GenLayoutSettings = ProjectConfig.genDefaults;

  /**
   * Сборка по умолчанию — только при раскладке по умолчанию: при своей
   * раскладке без `gen.assembly` она неизвестна, и генератор не подключает
   * модуль сам, а печатает общую подсказку.
   */
  static readonly defaultAssembly = 'src/runners/assembly';

  /** Kernel по умолчанию — как сборка, только при раскладке по умолчанию */
  static readonly defaultKernel = 'src/platform/kernel';

  /** Раскладка из `.dmg/config.json`; нет файла — по умолчанию; бросает `ProjectConfigError` */
  static async read(root: string): Promise<GenLayout> {
    const config = await ProjectConfig.read(root);
    return config === undefined
      ? new GenLayout({ ...ProjectConfig.genDefaults }, root)
      : GenLayout.from(config, root);
  }

  /** Раскладка по разобранному конфигу: секция `gen` и места слоёв, от корня root */
  static from(config: ProjectConfig, root: string): GenLayout {
    return new GenLayout(config.gen, root, config.layers);
  }

  private static fail(message: string): never {
    throw new ProjectConfigError(`${ProjectConfig.file}: ${message}`);
  }

  /** layers — места слоёв поставщиков */
  constructor(
    private readonly settings: GenLayoutSettings,
    /** Корень проекта, от которого строятся пути; «.» (у CLI) оставляет их относительными */
    readonly root: string,
    private readonly layers: Readonly<Record<string, LayerPlace>> = {},
  ) {}

  domainDir(module: string): string {
    return this.path(this.settings.domain, module);
  }

  backendDir(module: string): string {
    return this.path(this.settings.backend, module);
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

  /**
   * Каталоги слоёв — значение `ArchApp.layout` (D-106, D-107): абсолютные,
   * `{m}` сохраняется. Нет каталога kernel или сборки — Error.
   */
  dirs(): FrameworkDirs {
    const { domain, backend } = this.settings;
    return {
      kernel: this.requiredDir('kernel'),
      domain: resolve(this.root, domain),
      backend: resolve(this.root, backend),
      assembly: this.requiredDir('assembly'),
    };
  }

  /**
   * Каталоги слоёв поставщиков — значение `ArchApp.layers` (D-107):
   * абсолютные, `{m}` сохраняется
   */
  layerDirs(): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(this.layers).map(([name, place]) => [
        name,
        [resolve(this.root, place.dir)],
      ]),
    );
  }

  /** Имена слоёв поставщиков — ключи `layers` в порядке конфига */
  layerNames(): string[] {
    return Object.keys(this.layers);
  }

  /** Каталог слоя для модуля: `{m}` подставлен, путь от корня; слоя нет — `GenError` */
  layerDir(layer: string, module: string): string {
    return this.path(this.place(layer).dir, module);
  }

  /** Пакет workspaces слоя для модуля; у слоя нет `package` — undefined */
  layerPackage(layer: string, module: string): LayerPackage | undefined {
    const { package: name } = this.place(layer);
    if (name === undefined) return undefined;
    const src = this.layerDir(layer, module);
    const dir = src.endsWith(SRC) ? src.slice(0, -SRC.length) : src;
    return {
      dir,
      name: this.fill(name, module),
      root: relative(dir, this.root).split(sep).join('/'),
    };
  }

  /** Слои поставщиков одной строкой — первая строка вывода вида поставщика */
  describeLayers(): string {
    const places = Object.entries(this.layers).map(([name, place]) => {
      const line = `${name} — ${place.dir}`;
      return place.package === undefined
        ? line
        : `${line} (пакет ${place.package})`;
    });
    return places.length === 0
      ? `слои не заданы (layers в ${ProjectConfig.file})`
      : `слои: ${places.join(', ')}`;
  }

  private place(layer: string): LayerPlace {
    const place = Object.hasOwn(this.layers, layer)
      ? this.layers[layer]
      : undefined;
    if (place === undefined) {
      throw new GenError(
        `слой «${layer}» не задан в ${ProjectConfig.file} (layers)`,
      );
    }
    return place;
  }

  private requiredDir(key: DirKey): string {
    const dir = this.dirSetting(key);
    if (dir === undefined) {
      return GenLayout.fail(
        `gen.${key} не задан — каталог ${key} нужен проверке слоёв`,
      );
    }
    return resolve(this.root, dir);
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
