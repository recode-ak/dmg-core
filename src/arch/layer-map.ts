import { relative, resolve, sep } from 'node:path';
import type { AnyModuleDef } from '../domain/contracts/module-def';
import type { DefIndex } from '../graph/def-index';
import type { GraphProvider } from '../graph/graph-provider';
import type { SourceLayer } from '../graph/source-layer.types';
import { FRAMEWORK_LAYERS, IMPLEMENTATION_LAYERS } from './framework-layers';
import type { LayerPlaces } from './layer-checker.types';
import type { LayerPlace } from './layer-map.types';
import { SourceScan } from './source-scan';
import { Violation } from './violation';

const MODULE = '{m}';

/**
 * Каталоги слоёв приложения и слои поставщиков (D-107): чей файл и какой
 * слой. Ошибка раскладки или слоя поставщика — отказ в конструкторе.
 * @see src/arch/layer-checker.test.ts
 */
export class LayerMap {
  /** `ArchApp.project`, разрешённый в абсолютный путь: с ним сверяются каталоги и цели. */
  readonly project: string;
  /** Нарушения ARC-13: слой поставщика без каталога, каталог без слоя. */
  readonly issues: readonly Violation[];
  private readonly layers = new Map<string, SourceLayer>();
  /** Владелец слоя поставщика по имени слоя. */
  private readonly owners = new Map<string, string>();
  /** От самого глубокого каталога: файл принадлежит первому, что его содержит. */
  private readonly places: readonly LayerPlace[];
  private readonly scan = new SourceScan();

  constructor(
    index: DefIndex,
    private readonly app: LayerPlaces,
    providers: readonly GraphProvider[],
  ) {
    this.project = resolve(app.project);
    for (const layer of FRAMEWORK_LAYERS) this.layers.set(layer.name, layer);
    this.declare(providers);
    this.issues = this.undeclared();
    this.places = this.locate(index.modules).sort(
      (a, b) => b.dir.length - a.dir.length,
    );
  }

  /** Каталог слоя, которому принадлежит путь, или `undefined` — вне слоёв. */
  placeOf(path: string): LayerPlace | undefined {
    return this.places.find((place) => this.scan.inside(path, place.dir));
  }

  // Имена слоёв поставщиков — до проверки рёбер: `sees` может вести к слою
  // поставщика, объявленного позже.
  private declare(providers: readonly GraphProvider[]): void {
    const declared: SourceLayer[] = [];
    for (const provider of providers) {
      for (const layer of provider.layers?.() ?? []) {
        const at = `ARC-13: слой ${layer.name} поставщика ${provider.name}`;
        const owner = this.owners.get(layer.name);
        if (this.layers.has(layer.name) && owner === undefined) {
          throw new Error(`${at} — имя занято слоем dmg-core`);
        }
        if (owner === provider.name) throw new Error(`${at} объявлен дважды`);
        if (owner !== undefined) {
          throw new Error(
            `ARC-13: слой ${layer.name} у двух поставщиков — ${owner} и ${provider.name}`,
          );
        }
        this.layers.set(layer.name, layer);
        this.owners.set(layer.name, provider.name);
        declared.push(layer);
      }
    }
    for (const layer of declared) this.verifyEdges(layer);
  }

  /** Рёбра слоя поставщика: не к реализациям; `seenBy` — только слои фреймворка. */
  private verifyEdges(layer: SourceLayer): void {
    const at = `ARC-13: слой ${layer.name} поставщика ${this.owners.get(layer.name)}`;
    const closed = (edge: string, to: string): string =>
      `${at} — ${edge} к ${to}: слои реализаций поставщику недоступны`;
    for (const { layer: to } of layer.sees) {
      if (IMPLEMENTATION_LAYERS.includes(to))
        throw new Error(closed('sees', to));
      if (!this.layers.has(to)) {
        throw new Error(`${at} — sees к неизвестному слою ${to}`);
      }
    }
    for (const { layer: by } of layer.seenBy ?? []) {
      if (IMPLEMENTATION_LAYERS.includes(by)) {
        throw new Error(closed('seenBy', by));
      }
      if (!FRAMEWORK_LAYERS.some((l) => l.name === by)) {
        throw new Error(`${at} — seenBy к ${by}: только к слоям dmg-core`);
      }
    }
  }

  // Пустой список каталогов — то же, что нет ключа: иначе слой молча без проверок.
  private undeclared(): Violation[] {
    const given = this.app.layers ?? {};
    return [
      ...[...this.owners]
        .filter(
          ([name]) => !Object.hasOwn(given, name) || given[name]?.length === 0,
        )
        .map(
          ([name, owner]) =>
            new Violation(
              'ARC-13',
              `слой ${name} поставщика ${owner} без каталога в ArchApp.layers`,
            ),
        ),
      ...Object.keys(given)
        .filter((name) => !this.owners.has(name))
        .map(
          (name) =>
            new Violation(
              'ARC-13',
              `ArchApp.layers.${name} — слой не объявлен поставщиками графа`,
            ),
        ),
    ];
  }

  // Модуль `app` занял бы каталог общего реализаций (D-106) — отказ по имени,
  // а не по совпавшим каталогам.
  private locate(modules: readonly AnyModuleDef[]): LayerPlace[] {
    if (modules.some((m) => m.name === 'app')) {
      throw new Error(
        'модуль app: каталог реализации совпадает с общим реализаций backend/app — имя зарезервировано (D-106)',
      );
    }
    const { layout, runners } = this.app;
    const domain = this.template('ArchApp.layout.domain', layout.domain);
    const backend = this.template('ArchApp.layout.backend', layout.backend);
    const places: LayerPlace[] = [];
    this.add(places, 'kernel', layout.kernel);
    this.add(places, 'domain', this.rootOf(domain));
    for (const m of modules) {
      this.add(places, 'domain', this.fill(domain, m.name), m);
      this.add(places, 'backend', this.fill(backend, m.name), m);
    }
    this.add(places, 'backend-app', this.fill(backend, 'app'));
    this.add(places, 'assembly', layout.assembly);
    for (const dir of runners) this.add(places, 'runner', dir);
    for (const [name, dirs] of Object.entries(this.app.layers ?? {})) {
      if (!this.owners.has(name)) continue;
      for (const dir of dirs) this.addProvided(places, name, dir, modules);
    }
    return places;
  }

  /** Каталог слоя поставщика: у слоя по модулям — шаблон с `{m}`, иначе без. */
  private addProvided(
    places: LayerPlace[],
    name: string,
    dir: string,
    modules: readonly AnyModuleDef[],
  ): void {
    const field = `ArchApp.layers.${name}`;
    if (this.layer(name).perModule === true) {
      const each = this.template(field, dir);
      for (const m of modules)
        this.add(places, name, this.fill(each, m.name), m);
      return;
    }
    if (dir.includes(MODULE)) {
      throw new Error(`${field} — {m} только у слоя по модулям`);
    }
    this.add(places, name, dir);
  }

  // Каталог вне проекта не обходился бы и не проверялся как цель — отказ, а
  // не молчание; раньше добавленный слой в отказе о совпадении назван первым.
  private add(
    places: LayerPlace[],
    name: string,
    path: string,
    module?: AnyModuleDef,
  ): void {
    const layer = this.layer(name);
    const dir = resolve(path);
    if (!this.scan.inside(dir, this.project)) {
      throw new Error(`каталог слоя ${name} вне ArchApp.project: ${dir}`);
    }
    const twin = places.find((p) => p.dir === dir);
    if (twin !== undefined) {
      throw new Error(
        `ArchApp: у слоёв ${twin.layer.name} и ${name} один каталог ${this.path(dir)}`,
      );
    }
    const foreign =
      layer.axis === 'implementation' && module?.external === true;
    places.push(
      module === undefined
        ? { layer, dir, foreign }
        : { layer, dir, module, foreign },
    );
  }

  private layer(name: string): SourceLayer {
    const layer = this.layers.get(name);
    if (layer === undefined) throw new Error(`нет слоя ${name}`);
    return layer;
  }

  private template(field: string, dir: string): string {
    if (!dir.includes(MODULE)) throw new Error(`${field} — шаблон с {m}`);
    return dir;
  }

  /** Корень слоя по модулям (D-107) — путь до сегмента с `{m}`: там `<имя>.app.ts`. */
  private rootOf(template: string): string {
    const parts = resolve(template).split(sep);
    const at = parts.findIndex((p) => p.includes(MODULE));
    return parts.slice(0, at).join(sep) || sep;
  }

  private fill(template: string, module: string): string {
    return template.replaceAll(MODULE, module);
  }

  private path(dir: string): string {
    return relative(this.project, dir).split(sep).join('/');
  }
}
