import type { AnyModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import type { GraphApp } from '../graph/domain/graph-app.types';
import { AppDefChecker } from './app-def-checker';
import { DefChecker } from './def-checker';
import { FileChecker, type ModuleLayout } from './file-checker';
import { LayerChecker } from './layer-checker';
import type { FrameworkDirs, LayerPlaces } from './layer-checker.types';
import { LayerMap } from './layer-map';
import { ProviderRuleChecker } from './provider-rule-checker';
import { UnitChecker } from './unit-checker';
import type { UnitPlaces } from './unit-checker.types';
import { UnitMap } from './unit-map';
import type { Violation } from './violation';

/**
 * Приложение для `arch:check` (D-52, D-107, D-108): вход графа (`def`, D-93;
 * `providers`, D-97), места слоёв `LayerPlaces` (проект, `GenLayout.dirs()`,
 * раннеры, слои поставщиков, `entry`, `testing`) и файл входа графа
 * `graphEntry` (`UnitPlaces`, ARC-16; проверяется только при единицах).
 */
export type ArchApp = GraphApp & LayerPlaces & UnitPlaces;

/**
 * Контрактные проверки по индексу Def: Def (`DefChecker`), а с приложением —
 * `AppDef` (`AppDefChecker`), файлы модулей (`FileChecker`), импорты по слоям
 * (`LayerChecker`), единицы выноса (`UnitChecker`) и правила поставщиков
 * графа (`ProviderRuleChecker`). Без приложения — только Def.
 * @see src/arch/arch-checker.test.ts
 */
export class ArchChecker {
  private readonly defs: DefChecker;
  private readonly app: AppDefChecker | undefined;
  private readonly files: FileChecker | undefined;
  private readonly layers: LayerChecker | undefined;
  private readonly units: UnitChecker | undefined;
  private readonly providers: ProviderRuleChecker | undefined;

  /**
   * Неверный ID правила или слоя поставщика — исключение ARC-13
   * (`ProviderRuleChecker`); неверные места слоёв — исключение `LayerMap`;
   * единица `workspaces` без `name` — исключение `UnitMap`. Неверный
   * `graphEntry` при единицах — исключение в `check()`.
   */
  constructor(index: DefIndex, app?: ArchApp) {
    this.defs = new DefChecker(index);
    if (app === undefined) return;
    this.app = new AppDefChecker(app.def);
    this.providers = new ProviderRuleChecker(app);
    this.files = new FileChecker(index, ArchChecker.modules(app.layout));
    // Одна карта слоёв на два проверяющих: слои поставщиков разбираются раз.
    const map = new LayerMap(index, app, app.providers ?? []);
    this.layers = new LayerChecker(map, app);
    this.units = new UnitChecker(map, UnitMap.read(map.project), app);
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

  /** Порядок: `AppDef`, Def, файлы модулей, слои, единицы, правила поставщиков. */
  check(): Violation[] {
    return [
      ...(this.app?.check() ?? []),
      ...this.defs.check(),
      ...(this.files?.check() ?? []),
      ...(this.layers?.check() ?? []),
      ...(this.units?.check() ?? []),
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
