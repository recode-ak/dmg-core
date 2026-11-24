import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ImportSpecifier } from './import-specifier';
import type { LayerPlaces } from './layer-checker.types';
import type { LayerMap } from './layer-map';
import type { LayerPlace } from './layer-map.types';
import { SourceScan } from './source-scan';
import type { SourceImport } from './source-scan.types';
import type { UnitPlaces } from './unit-checker.types';
import type { UnitMap } from './unit-map';
import type { Unit } from './unit-map.types';
import { Violation } from './violation';

/** Файл единицы: путь от `project` через `/`, абсолютный путь, единица, тестовый ли код. */
type UnitFile = {
  readonly file: string;
  readonly path: string;
  readonly unit: Unit;
  readonly test: boolean;
};

const PAST_EXPORTS = 'мимо exports (или пакет не установлен — bun install)';

/**
 * Единицы выноса (D-108): пакет объявляет всё, что импортирует (ARC-14);
 * между пакетами — только имя и `exports` (ARC-15); платформа приложения не
 * зависит от реализаций и раннеров, замыкание входа графа не доходит до
 * реализаций (ARC-16). Без единиц (`single`) — молчит, вход графа не проверяется.
 * @see src/arch/unit-checker.test.ts
 */
export class UnitChecker {
  private readonly scan = new SourceScan();
  private readonly testing: string;

  constructor(
    private readonly map: LayerMap,
    private readonly units: UnitMap,
    private readonly places: UnitPlaces & Pick<LayerPlaces, 'testing'>,
  ) {
    this.testing = places.testing ?? 'testing';
  }

  /** Порядок: ARC-16 по `package.json` единиц, ARC-14/15 по файлам, ARC-16 по входу графа. */
  check(): Violation[] {
    if (this.units.units.length === 0) return [];
    const entry = this.graphEntry();
    return [...this.declarations(), ...this.files(), ...this.closure(entry)];
  }

  private graphEntry(): string {
    const entry = resolve(this.places.graphEntry);
    if (!this.scan.inside(entry, this.map.project)) {
      throw new Error(
        `ArchApp.graphEntry — файл вне ArchApp.project: ${entry}`,
      );
    }
    if (statSync(entry, { throwIfNoEntry: false })?.isFile() !== true) {
      throw new Error(`ArchApp.graphEntry — нет файла: ${entry}`);
    }
    return entry;
  }

  /** ARC-16 (а): единица платформы приложения объявляет единицу реализаций или раннеров — в любой секции. */
  private declarations(): Violation[] {
    return this.units.units
      .filter((unit) => this.map.axesIn(unit.dir).has('platform'))
      .flatMap((unit) =>
        [...new Set([...unit.working, ...unit.dev])].sort().flatMap((name) => {
          const target = this.units.named(name);
          const role = target === undefined ? undefined : this.roleOf(target);
          return target === unit || role === undefined
            ? []
            : [
                new Violation(
                  'ARC-16',
                  `${this.rel(unit.dir)}/package.json (${unit.name}) объявляет ${name} — ${role}`,
                ),
              ];
        }),
      );
  }

  // Реализация раньше раннера: единица на обеих осях — реализация.
  private roleOf(unit: Unit): string | undefined {
    const axes = this.map.axesIn(unit.dir);
    if (axes.has('implementation')) return 'реализацию';
    return axes.has('runner') ? 'раннер' : undefined;
  }

  // Файлы корня вне единиц (`scripts/`) не выносятся — ARC-14/15 их не касаются.
  private files(): Violation[] {
    const { project } = this.map;
    return this.scan.projectFiles(project).flatMap((file) => {
      const path = join(project, file);
      const unit = this.units.unitOf(path);
      if (unit === undefined) return [];
      const at: UnitFile = {
        file,
        path,
        unit,
        test: this.scan.isTest(file, this.testing),
      };
      return this.scan
        .specifiers(path)
        .flatMap((imp) => this.checkImport(at, imp));
    });
  }

  private checkImport(at: UnitFile, imp: SourceImport): Violation[] {
    const specifier = new ImportSpecifier(imp.spec);
    if (specifier.kind === 'path') return this.boundary(at, imp.spec);
    const name = specifier.packageName;
    if (name === undefined || name === at.unit.name) return [];
    return [
      ...this.declared(at, name, imp.spec),
      ...this.exported(at, name, imp),
    ];
  }

  /**
   * ARC-15: относительный путь — только внутри своей единицы, и в тестовом
   * коде. Граница лексическая: цель вне каталога или во вложенной единице.
   */
  private boundary({ file, path, unit }: UnitFile, spec: string): Violation[] {
    const target = resolve(dirname(path), spec);
    return this.units.unitOf(target) === unit
      ? []
      : [
          new Violation(
            'ARC-15',
            `${file} (${unit.name}) импортирует за границу пакета относительным путём: ${spec}`,
          ),
        ];
  }

  /** ARC-14 — по спецификатору, не по разрешению: пакет корня виден при обходе вверх. */
  private declared(
    { file, unit, test }: UnitFile,
    name: string,
    spec: string,
  ): Violation[] {
    const where = `${file} (${unit.name}) импортирует ${name}`;
    if (unit.working.has(name)) return [];
    if (!unit.dev.has(name)) {
      return [
        new Violation(
          'ARC-14',
          `${where} — нет в package.json единицы: ${spec}`,
        ),
      ];
    }
    return test
      ? []
      : [
          new Violation(
            'ARC-14',
            `${where} из devDependencies в рабочем коде: ${spec}`,
          ),
        ];
  }

  /**
   * ARC-15: объявленная единица не разрешилась — спецификатор мимо `exports`
   * или установки нет. Своего разбора `exports` нет: решает резолвер Bun.
   * Необъявленная единица — только ARC-14 (в изолированной установке её нет).
   */
  private exported(
    { file, unit }: UnitFile,
    name: string,
    { spec, target }: SourceImport,
  ): Violation[] {
    const declared = unit.working.has(name) || unit.dev.has(name);
    if (!declared || target !== undefined || !this.units.named(name)) {
      return [];
    }
    return [
      new Violation(
        'ARC-15',
        `${file} (${unit.name}) импортирует ${name} ${PAST_EXPORTS}: ${spec}`,
      ),
    ];
  }

  /**
   * ARC-16 (б): обход в ширину от входа графа по разрешённым `.ts` проекта.
   * Цель в слое реализаций — нарушение, глубже от неё обход не идёт; раннеры
   * и слои поставщиков проходятся. `import type` учитывается (GR-02).
   */
  private closure(entry: string): Violation[] {
    const found: Violation[] = [];
    const seen = new Set([entry]);
    const queue = [entry];
    // `for…of` по массиву видит элементы, добавленные во время обхода.
    for (const file of queue) {
      for (const { spec, target } of this.scan.imports(file)) {
        const source = this.source(target);
        if (source === undefined) continue;
        const place = this.map.placeOf(source);
        if (place?.layer.axis === 'implementation') {
          found.push(
            new Violation(
              'ARC-16',
              `вход графа ${this.rel(entry)} доходит до реализации: ${this.rel(file)} импортирует ${this.title(place)}: ${spec}`,
            ),
          );
        } else if (!seen.has(source)) {
          seen.add(source);
          queue.push(source);
        }
      }
    }
    return found;
  }

  /**
   * `.ts`-файл цели — кода проекта (`SourceScan.inProject`), или `undefined`.
   * Относительный путь приходит без расширения: `<цель>.ts`, затем
   * `<цель>/index.ts`.
   */
  private source(target: string): string | undefined {
    if (!this.scan.inProject(target, this.map.project)) return undefined;
    const candidates = target.endsWith('.ts')
      ? [target]
      : [`${target}.ts`, join(target, 'index.ts')];
    return candidates.find((path) => existsSync(path));
  }

  private title(place: LayerPlace): string {
    return place.module === undefined
      ? place.layer.name
      : `${place.layer.name} ${place.module.name}`;
  }

  private rel(path: string): string {
    return relative(this.map.project, path).split(sep).join('/');
  }
}
