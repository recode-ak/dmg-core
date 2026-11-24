import type { AnyModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import type { GraphApp } from '../graph/domain/graph-app.types';
import { AppDefChecker } from './app-def-checker';
import { DefChecker } from './def-checker';
import { FileChecker, type ModuleLayout } from './file-checker';
import { LayerChecker } from './layer-checker';
import type { FrameworkDirs, LayerPlaces } from './layer-checker.types';
import { ProviderRuleChecker } from './provider-rule-checker';
import type { Violation } from './violation';

/**
 * Приложение для `arch:check` (D-52, D-107): вход графа (`def`, D-93;
 * `providers` с правилами и слоями, D-97) и места слоёв `LayerPlaces` —
 * проект, каталоги слоёв фреймворка (`GenLayout.dirs()`), раннеры, слои
 * поставщиков, входы модуля (`entry`, `testing`).
 */
export type ArchApp = GraphApp & LayerPlaces;

/**
 * Контрактные проверки по индексу Def: Def (`DefChecker`), а с приложением —
 * `AppDef` (`AppDefChecker`), файлы модулей (`FileChecker`), импорты по слоям
 * (`LayerChecker`) и правила поставщиков графа (`ProviderRuleChecker`). Без
 * приложения — только Def.
 * @see src/arch/arch-checker.test.ts
 */
export class ArchChecker {
  private readonly defs: DefChecker;
  private readonly app: AppDefChecker | undefined;
  private readonly files: FileChecker | undefined;
  private readonly layers: LayerChecker | undefined;
  private readonly providers: ProviderRuleChecker | undefined;

  /**
   * Неверный ID правила или слоя поставщика — исключение ARC-13
   * (`ProviderRuleChecker`); неверные места слоёв — исключение `LayerMap`.
   */
  constructor(index: DefIndex, app?: ArchApp) {
    this.defs = new DefChecker(index);
    if (app === undefined) return;
    this.app = new AppDefChecker(app.def);
    this.providers = new ProviderRuleChecker(app);
    this.files = new FileChecker(index, ArchChecker.modules(app.layout));
    this.layers = new LayerChecker(index, app, app.providers ?? []);
  }

  /** Все проверки приложения; индекс — замыкание состава по `dependsOn`. */
  static of(app: ArchApp): ArchChecker {
    return new ArchChecker(DefIndex.from(app.def.modules), app);
  }

  /** Только проверки Def по корневым модулям — для теста модуля домена. */
  static defsOf(roots: readonly AnyModuleDef[]): ArchChecker {
    return new ArchChecker(DefIndex.from(roots));
  }

  /** Каталоги модуля по шаблонам слоёв фреймворка: `{m}` — имя модуля. */
  private static modules(
    dirs: FrameworkDirs,
  ): (module: string) => ModuleLayout {
    return (m) => ({
      domain: dirs.domain.replaceAll('{m}', m),
      backend: dirs.backend.replaceAll('{m}', m),
    });
  }

  /** Порядок: `AppDef`, Def, файлы модулей, слои, правила поставщиков. */
  check(): Violation[] {
    return [
      ...(this.app?.check() ?? []),
      ...this.defs.check(),
      ...(this.files?.check() ?? []),
      ...(this.layers?.check() ?? []),
      ...(this.providers?.check() ?? []),
    ];
  }

  /**
   * Предупреждения: незаполненные `TODO` в текстах Def, метках статусов и
   * (с приложением) Policy (MAN-01). Не входят в `check()` — заготовки после
   * `gen` проходят его без правок.
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
