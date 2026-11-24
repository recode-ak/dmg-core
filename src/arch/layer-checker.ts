import { join } from 'node:path';
import type { LayerAccess } from '../graph/source-layer.types';
import { OUTSIDE_ACCESS } from './framework-layers';
import type { LayerPlaces } from './layer-checker.types';
import type { LayerMap } from './layer-map';
import type { LayerPlace } from './layer-map.types';
import { SourceScan } from './source-scan';
import type { ResolvedImport } from './source-scan.types';
import { Violation } from './violation';

/** Импорт файла проекта: путь от `project` через `/` и абсолютный, его каталог слоя и цель. */
type Import = {
  readonly file: string;
  readonly path: string;
  readonly from: LayerPlace | undefined;
  readonly to: LayerPlace;
  readonly spec: string;
  readonly target: string;
};

/**
 * Импорты файлов проекта по слоям (D-107, D-110, D-70, D-37, D-111): видимость
 * слоёв, вход модуля, чужие модули (`others`), вход `testing`. Нарушение — с
 * ID слоя-импортёра или доступа и местом — файлом импортёра; порядок — по
 * пути файла, в файле — по импортам.
 * @see src/arch/layer-checker.test.ts
 */
export class LayerChecker {
  private readonly scan = new SourceScan();
  private readonly entry: string;
  private readonly testing: string;

  /** Карту слоёв строит `ArchChecker` — одну на проверяющих слоёв и единиц. */
  constructor(
    private readonly map: LayerMap,
    places: Pick<LayerPlaces, 'entry' | 'testing'>,
  ) {
    this.entry = places.entry ?? 'index';
    this.testing = places.testing ?? 'testing';
  }

  check(): Violation[] {
    const { project } = this.map;
    return [
      ...this.map.issues,
      ...this.scan
        .projectFiles(project)
        .flatMap((file) => this.checkFile(file, join(project, file))),
    ];
  }

  // Реализация внешнего модуля — не код приложения (D-37): не обходится.
  private checkFile(file: string, path: string): Violation[] {
    const from = this.map.placeOf(path);
    if (from?.foreign === true) return [];
    return this.scan
      .imports(path)
      .flatMap((imp) => this.checkImport(file, path, from, imp));
  }

  // Пакет вне проекта или в `node_modules` — дело линтера, не слоёв.
  private checkImport(
    file: string,
    path: string,
    from: LayerPlace | undefined,
    { spec, target }: ResolvedImport,
  ): Violation[] {
    if (!this.scan.inProject(target, this.map.project)) return [];
    const to = this.map.placeOf(target);
    if (to === undefined) {
      return from === undefined
        ? []
        : [
            new Violation(
              from.layer.rule,
              `${this.where(file, from)} импортирует файл вне слоёв: ${spec}`,
              path,
            ),
          ];
    }
    const imp: Import = { file, path, from, to, spec, target };
    return from === undefined ? this.outside(imp) : this.layered(imp, from);
  }

  /** Файл вне слоёв видит всё, кроме модуля домена мимо входа (`OUTSIDE_ACCESS`). */
  private outside(imp: Import): Violation[] {
    const access = OUTSIDE_ACCESS.find((a) => a.layer === imp.to.layer.name);
    return access === undefined ? [] : this.entryOf(imp, access, access.rule);
  }

  private layered(imp: Import, from: LayerPlace): Violation[] {
    const { to } = imp;
    if (this.sameLayer(from, to)) return [];
    const access =
      from.layer.sees.find((a) => a.layer === to.layer.name) ??
      to.layer.seenBy?.find((a) => a.layer === from.layer.name);
    if (access === undefined) {
      return [
        new Violation(
          from.layer.rule,
          `${this.where(imp.file, from)} импортирует ${this.title(to)}: ${imp.spec}`,
          imp.path,
        ),
      ];
    }
    const rule = access.rule ?? from.layer.rule;
    const others = this.others(imp, from, access, rule);
    // Одно нарушение на импорт: вход закрытого модуля проверять незачем.
    if (access.others === 'none' && others.length > 0) return others;
    return [...this.entryOf(imp, access, rule), ...others];
  }

  /** Свой слой свободен; у слоя по модулям — свой модуль и корень слоя. */
  private sameLayer(from: LayerPlace, to: LayerPlace): boolean {
    return (
      from.layer.name === to.layer.name &&
      (from.layer.perModule === undefined ||
        to.module === undefined ||
        from.module?.name === to.module.name)
    );
  }

  /**
   * Вход каталога цели (D-70, D-37, D-110): `own` для своего модуля, иначе
   * `entries`, нет списка — любой файл (при `others: 'none'` `entries` нет);
   * `testing` — только тестовому коду (TST-07), при любом списке. Корень слоя
   * по модулям, реализация внешнего модуля и импорт между внешними — без проверки.
   */
  private entryOf(
    { file, path, from, to, spec, target }: Import,
    access: LayerAccess,
    rule: string,
  ): Violation[] {
    if (
      to.foreign ||
      (to.module === undefined && to.layer.perModule !== undefined) ||
      (from?.module?.external === true && to.module?.external === true)
    ) {
      return [];
    }
    const own =
      from?.module !== undefined && from.module.name === to.module?.name;
    const list = own && access.own !== undefined ? access.own : access.entries;
    const entry = to.layer.entry ?? this.entry;
    const names = [
      ...new Set((list ?? []).map((e) => (e === 'public' ? entry : 'index'))),
    ];
    if (names.some((name) => this.scan.isEntry(target, to.dir, name))) {
      return [];
    }
    const where = this.where(file, from);
    if (
      to.module !== undefined &&
      to.layer.testEntry === true &&
      this.scan.isEntry(target, to.dir, this.testing)
    ) {
      return this.scan.isTest(file, this.testing)
        ? []
        : [
            new Violation(
              'TST-07',
              `${where} импортирует ${this.testing}.ts модуля ${to.module.name} — вход только для тестового кода: ${spec}`,
              path,
            ),
          ];
    }
    if (list === undefined) return [];
    const entries = names.map((name) => `${name}.ts`).join(' и ');
    return [
      new Violation(
        rule,
        `${where} импортирует ${this.title(to)} мимо ${entries}: ${spec}`,
        path,
      ),
    ];
  }

  /**
   * Чужой модуль слоя-цели (D-110): `none` — нарушение, и у импортёра без
   * модуля; `dependsOn` — только из `dependsOn` модуля импортёра, и между
   * внешними. Корень слоя-цели — не модуль.
   */
  private others(
    { file, path, to, spec }: Import,
    from: LayerPlace,
    access: LayerAccess,
    rule: string,
  ): Violation[] {
    const { module } = from;
    const target = to.module?.name;
    if (target === undefined || target === module?.name) return [];
    const where = this.where(file, from);
    switch (access.others) {
      case 'none':
        return [
          new Violation(
            rule,
            `${where} импортирует ${this.title(to)} — виден только свой модуль: ${spec}`,
            path,
          ),
        ];
      case 'dependsOn':
        if (
          module === undefined ||
          (module.dependsOn ?? []).some((m) => m.name === target)
        ) {
          return [];
        }
        return [
          new Violation(
            rule,
            `${where} импортирует ${target}, которого нет в dependsOn ${module.name}`,
            path,
          ),
        ];
      case undefined:
        return [];
    }
  }

  private where(file: string, from: LayerPlace | undefined): string {
    return `${file} (${from?.layer.name ?? 'вне слоёв'})`;
  }

  private title(place: LayerPlace): string {
    return place.module === undefined
      ? place.layer.name
      : `${place.layer.name} ${place.module.name}`;
  }
}
