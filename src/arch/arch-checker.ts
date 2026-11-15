import type { AnyAppDef } from '../domain/contracts/app-def';
import type { AnyModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import { AppDefChecker } from './app-def-checker';
import { AssemblyChecker } from './assembly-checker';
import type { AssemblyPlaces } from './assembly-checker.types';
import { DefChecker } from './def-checker';
import { FileChecker, type ModuleLayout } from './file-checker';
import type { Violation } from './violation';

/**
 * Приложение для `arch:check` (D-52): манифест (`def`, D-93), файлы модулей,
 * их входы (`entry`, по умолчанию `index`; `testing` — фикстуры, см.
 * `FileChecker`); необязательно — каталоги корня сборки (`root`) и раннеров
 * (`runners`), их импорты — `AssemblyChecker`.
 */
export type ArchApp = {
  readonly def: AnyAppDef;
  readonly layout: (module: string) => ModuleLayout;
  readonly entry?: string;
  readonly testing?: string;
  readonly root?: string;
  readonly runners?: readonly string[];
};

/**
 * Контрактные проверки по индексу Def: Def (`DefChecker`), `AppDef` при
 * наличии (`AppDefChecker`), при раскладке — файлы модулей (`FileChecker`),
 * корень сборки и раннеры (`AssemblyChecker`). Без раскладки — только Def:
 * так проверяют модуль домена в его тесте.
 */
export class ArchChecker {
  private readonly defs: DefChecker;
  private readonly files: FileChecker | undefined;
  private readonly assembly: AssemblyChecker | undefined;
  private readonly app: AppDefChecker | undefined;

  constructor(
    index: DefIndex,
    layout?: (module: string) => ModuleLayout,
    entry = 'index',
    places: AssemblyPlaces = {},
    testing = 'testing',
    app?: AnyAppDef,
  ) {
    this.app = app && new AppDefChecker(app);
    this.defs = new DefChecker(index);
    this.files = layout && new FileChecker(index, layout, entry, testing);
    this.assembly =
      layout && new AssemblyChecker(index, layout, entry, places, testing);
  }

  /**
   * Все проверки приложения: `AppDef` (`AppDefChecker`), по Def, по файлам
   * модулей и вокруг них. Индекс — замыкание состава по `dependsOn`.
   */
  static of(app: ArchApp): ArchChecker {
    return new ArchChecker(
      DefIndex.from(app.def.modules),
      app.layout,
      app.entry,
      { root: app.root, runners: app.runners },
      app.testing,
      app.def,
    );
  }

  /** Только проверки Def по корневым модулям — для теста модуля домена. */
  static defsOf(roots: readonly AnyModuleDef[]): ArchChecker {
    return new ArchChecker(DefIndex.from(roots));
  }

  check(): Violation[] {
    return [
      ...(this.app?.check() ?? []),
      ...this.defs.check(),
      ...(this.files?.check() ?? []),
      ...(this.assembly?.check() ?? []),
    ];
  }

  /**
   * Предупреждения: незаполненные `TODO` в текстах Def, метках статусов и
   * (при заданной раскладке) Policy (MAN-01). Не входят в `check()` —
   * заготовки после `gen` проходят его без правок.
   */
  todos(): Violation[] {
    return [
      ...(this.app?.todos() ?? []),
      ...this.defs.todos(),
      ...(this.files?.todos() ?? []),
    ];
  }

  /** Строки отчёта: `<ID правила>: <сообщение>`. */
  report(): string[] {
    return this.check().map((v) => v.format());
  }
}
