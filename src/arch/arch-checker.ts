import type { AnyModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import type { GraphApp } from '../graph/domain/graph-app.types';
import { AppDefChecker } from './app-def-checker';
import { DefChecker } from './def-checker';
import { DeviationRegistry } from './deviation-registry';
import type { DebtPlaces } from './deviation-registry.types';
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
 * Приложение для `arch:check` (D-52, D-107, D-108, D-111): вход графа (`def`,
 * `providers`), места слоёв `LayerPlaces` (`layout` — `GenLayout.dirs()` или
 * нет), файл входа графа `graphEntry` (ARC-16, проверяется в обеих формах)
 * и реестр отступлений `debt` (ARC-12).
 */
export type ArchApp = GraphApp & LayerPlaces & UnitPlaces & DebtPlaces;

/**
 * Контрактные проверки по индексу Def: Def (`DefChecker`), а с приложением —
 * `AppDef` (`AppDefChecker`), файлы модулей (`FileChecker`, только при
 * `layout`), импорты по слоям (`LayerChecker`), единицы выноса
 * (`UnitChecker`), правила поставщиков графа (`ProviderRuleChecker`) и
 * отступления по реестру долга (`DeviationRegistry`). Без приложения — Def.
 * @see src/arch/arch-checker.test.ts
 */
export class ArchChecker {
  private readonly defs: DefChecker;
  private readonly app: AppDefChecker | undefined;
  private readonly files: FileChecker | undefined;
  private readonly layers: LayerChecker | undefined;
  private readonly units: UnitChecker | undefined;
  private readonly providers: ProviderRuleChecker | undefined;
  /** Реестр отступлений и ID, которые он вправе снять (`ProviderRuleChecker.debtIds`). */
  private readonly deviations:
    | {
        readonly registry: DeviationRegistry;
        readonly debtIds: ReadonlySet<string>;
      }
    | undefined;

  /**
   * Исключения: неверный ID правила или слоя поставщика — ARC-13
   * (`ProviderRuleChecker`), места слоёв — `LayerMap`, единица `workspaces`
   * без `name` — `UnitMap`, `debt` — `DeviationRegistry`; неверный
   * `graphEntry` — в `check()`.
   */
  constructor(index: DefIndex, app?: ArchApp) {
    this.defs = new DefChecker(index);
    if (app === undefined) return;
    this.app = new AppDefChecker(app.def);
    const providers = new ProviderRuleChecker(app);
    this.providers = providers;
    if (app.layout !== undefined) {
      this.files = new FileChecker(index, ArchChecker.modules(app.layout));
    }
    // Одна карта слоёв на два проверяющих: слои поставщиков разбираются раз.
    const map = new LayerMap(index, app, app.providers ?? []);
    this.layers = new LayerChecker(map, app);
    this.units = new UnitChecker(map, UnitMap.read(map.project), app);
    if (app.debt !== undefined) {
      this.deviations = {
        registry: DeviationRegistry.read(app.debt, map.project),
        debtIds: providers.debtIds,
      };
    }
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

  /**
   * Порядок: `AppDef`, Def, файлы модулей, слои, единицы, правила
   * поставщиков; с `debt` снятые отступления выпадают, строки ARC-12 реестра
   * — последними.
   */
  check(): Violation[] {
    const found = [
      ...(this.app?.check() ?? []),
      ...this.defs.check(),
      ...(this.files?.check() ?? []),
      ...(this.layers?.check() ?? []),
      ...(this.units?.check() ?? []),
      ...(this.providers?.check() ?? []),
    ];
    if (this.deviations === undefined) return found;
    const { registry, debtIds } = this.deviations;
    return registry.apply(found, debtIds);
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
