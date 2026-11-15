/**
 * Подключение модуля к приложению по маркерам каркаса: `gen module` — в
 * корень сборки, файл `AppDef` (`gen.appDef`) и зависимости; `gen aggregate` —
 * репозиторий в фабрику модуля. Нет файла или маркера — «Вставь вручную»;
 * нет корня сборки или файла `AppDef` в раскладке — только подсказка.
 * @see src/gen/kinds/app-wiring.test.ts
 */
import { dirname, join, relative, sep } from 'node:path';
import type { GenArgs } from '../cli';
import { LINE_WIDTH, namedImport } from '../import-order';
import { toCamel, toPascal } from '../naming';
import type { PlannedDependency, PlannedEdit } from '../plan';

/** Маркеры корня сборки и файла `AppDef`, которые пишет `dmg-core init`. */
export const WIRING_MARKERS = {
  /** Конец блока импортов. */
  imports: '// gen:imports',
  /** Конец списка модулей (`modules`) — в корне сборки и в `AppDef`. */
  modules: '// gen:modules',
  /** Конец объекта зависимостей в фабрике модуля `m`. */
  repos: (m: string) => `// gen:repos:${m}`,
};

/** Отступы вставок — по шаблонам каркаса (`AppSources`, `ProjectFiles`). */
const ELEMENT = '      ';
const REPO = '            ';
const APP_DEF_ELEMENT = '    ';

/** Правки подключения модуля `args.module` к корню сборки и файлу `AppDef`. */
export class AppWiring {
  private readonly m: string;
  private readonly P: string;
  /** `app.ts` корня сборки; undefined — корень сборки неизвестен. */
  private readonly app: string | undefined;
  /** Файл `AppDef`; undefined — `gen.appDef` не задан. */
  private readonly appDef: string | undefined;

  constructor(private readonly args: GenArgs) {
    this.m = args.module;
    this.P = toPascal(args.module);
    const dir = args.layout.compositionDir();
    this.app = dir === undefined ? undefined : join(dir, 'app.ts');
    this.appDef = args.layout.appDefFile();
  }

  /** `gen module`: фабрика и Def в корне сборки, Def в составе `AppDef`. */
  moduleEdits(): PlannedEdit[] {
    return [...this.appEdits(), ...this.appDefEdits()];
  }

  private appEdits(): PlannedEdit[] {
    const { app, m, P } = this;
    if (app === undefined) return [];
    const { imports, modules, repos } = WIRING_MARKERS;
    const def = `${P}ModuleDef`;
    const element = [
      `${ELEMENT}{`,
      `${ELEMENT}  def: ${def},`,
      `${ELEMENT}  create: (deps) =>`,
      `${ELEMENT}    create${P}Module({`,
      `${ELEMENT}      ...deps,`,
      `${ELEMENT}      ${repos(m)}`,
      `${ELEMENT}    }),`,
      `${ELEMENT}},`,
    ].join('\n');
    return [
      { path: app, marker: imports, line: this.importDef(dirname(app)) },
      {
        path: app,
        marker: imports,
        line: namedImport([`create${P}Module`], this.entry(dirname(app))),
      },
      { path: app, marker: modules, line: element },
    ];
  }

  /**
   * Файл `AppDef` лежит внутри пакета домена, поэтому импорт Def — всегда
   * относительный (даже при `gen.domainImport`); от корня сборки не зависит.
   */
  private appDefEdits(): PlannedEdit[] {
    const { appDef, P } = this;
    if (appDef === undefined) return [];
    const { imports, modules } = WIRING_MARKERS;
    const path = relative(dirname(appDef), this.args.layout.domainDir(this.m))
      .split(sep)
      .join('/');
    const from = `${path.startsWith('.') ? path : `./${path}`}/contract`;
    return [
      {
        path: appDef,
        marker: imports,
        line: namedImport([`${P}ModuleDef`], from),
      },
      {
        path: appDef,
        marker: modules,
        line: `${APP_DEF_ELEMENT}${P}ModuleDef,`,
      },
    ];
  }

  /**
   * Пакет модуля (`gen.package`) — зависимость пакета корня сборки; нет его
   * `package.json` в раскладке — пусто (см. `moduleNotes`).
   */
  moduleDependencies(): PlannedDependency[] {
    const pkg = this.args.layout.package(this.m);
    const path = this.args.layout.compositionPackage();
    if (pkg === undefined || path === undefined) return [];
    return [{ path, name: pkg.name, version: 'workspace:*' }];
  }

  /**
   * Что сделать после `gen module`: корень сборки неизвестен — подключить
   * руками; у пакета модуля — зависимость (если не вписана) и `bun install`.
   */
  moduleNotes(): string[] {
    const { layout } = this.args;
    const pkg = layout.package(this.m);
    const dir = layout.compositionDir();
    const install = pkg
      ? ['Затем bun install — чтобы пакет модуля появился в node_modules.']
      : [];
    const appDef = this.appDef === undefined ? [this.appDefHint()] : [];
    if (dir === undefined) {
      return [...this.manualWiring(), ...appDef, ...install];
    }
    if (pkg === undefined || layout.compositionPackage() !== undefined) {
      return [...appDef, ...install];
    }
    return [
      ...appDef,
      `Вставь вручную в package.json пакета с каталогом ${dir}, dependencies: "${pkg.name}": "workspace:*"`,
      ...install,
    ];
  }

  /**
   * `gen aggregate`: JSON-репозиторий агрегата `a` в фабрику модуля. Файл
   * данных — `<m>.<a>.json`: имя агрегата уникально только в модуле. Импорт
   * и строка репозитория — одна группа: конфликт имени импорта отменяет и
   * строку (иначе она сослалась бы на чужой класс).
   */
  aggregateEdits(a: string): PlannedEdit[] {
    const { app, m } = this;
    if (app === undefined) return [];
    const A = toPascal(a);
    const head = `${REPO}${toCamel(a)}Repo: new ${A}JsonRepo(`;
    const arg = `join(env.dataDir, '${m}.${a}.json')`;
    const line = `${head}${arg}),`;
    const repo =
      line.length <= LINE_WIDTH ? line : `${head}\n${REPO}  ${arg},\n${REPO}),`;
    const group = `repo:${m}.${a}`;
    return [
      {
        path: app,
        marker: WIRING_MARKERS.imports,
        line: namedImport([`${A}JsonRepo`], this.entry(dirname(app))),
        group,
      },
      { path: app, marker: WIRING_MARKERS.repos(m), line: repo, group },
    ];
  }

  /**
   * Общая подсказка, когда корень сборки неизвестен: что вставить, откуда
   * импортировать и какое поле задать, чтобы `gen` подключал модуль сам.
   */
  private manualWiring(): string[] {
    const { m, P } = this;
    const { layout } = this.args;
    const pkg = layout.package(m);
    const entry = pkg ? `'${pkg.name}'` : `${layout.appDir(m)}/index.ts`;
    const contract = this.contract();
    return [
      'Корень сборки не задан (gen.compositionRoot в dmg-core.json) — подключи модуль вручную:',
      '  корень сборки, список модулей (репозитории — в create вместе с deps):',
      `    { def: ${P}ModuleDef, create: (deps) => create${P}Module({ ...deps }) }`,
      `    create${P}Module — из входа ${entry}, ${P}ModuleDef — из ${contract}`,
      ...(pkg
        ? [
            `  package.json пакета корня сборки, dependencies: "${pkg.name}": "workspace:*"`,
          ]
        : []),
    ];
  }

  /** Подсказка, когда файл `AppDef` неизвестен: что вписать и откуда взять. */
  private appDefHint(): string {
    return `Вставь вручную в манифест приложения (gen.appDef в dmg-core.json), modules: ${this.P}ModuleDef (из ${this.contract()})`;
  }

  /** Контракт модуля — для подсказок: спецификатор или путь файла. */
  private contract(): string {
    const { layout } = this.args;
    return layout.hasDomainImport()
      ? `'${layout.domainImport(this.m, '.')}/contract'`
      : `${layout.domainDir(this.m)}/contract.ts`;
  }

  /** Импорт корня Def модуля из файла в каталоге `fromDir` — через contract. */
  private importDef(fromDir: string): string {
    const domain = this.args.layout.domainImport(this.m, fromDir);
    return namedImport([`${this.P}ModuleDef`], `${domain}/contract`);
  }

  /** Вход прикладного слоя модуля из каталога `fromDir`: имя пакета или путь. */
  private entry(fromDir: string): string {
    const pkg = this.args.layout.package(this.m);
    if (pkg !== undefined) return pkg.name;
    const path = relative(fromDir, this.args.layout.appDir(this.m))
      .split(sep)
      .join('/');
    return path.startsWith('.') ? path : `./${path}`;
  }
}
