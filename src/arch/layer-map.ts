import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { AnyModuleDef } from '../domain/contracts/module-def';
import type { DefIndex } from '../graph/def-index';
import type { GraphProvider } from '../graph/graph-provider';
import type {
  LayerAccess,
  LayerAxis,
  SourceLayer,
} from '../graph/source-layer.types';
import { FRAMEWORK_LAYERS, IMPLEMENTATION_LAYERS } from './framework-layers';
import type { FrameworkDirs, LayerPlaces } from './layer-checker.types';
import type { LayerModule, LayerPlace, LayerTemplate } from './layer-map.types';
import { SourceScan } from './source-scan';
import { Violation } from './violation';

const MODULE = '{m}';
/** Имя модуля поставщика — один сегмент пути и не шаблон `{m}`. */
const SEGMENT = /^[^/\\{}]+$/;
/** Вход слоя — имя файла без расширения и каталога. */
const FILE_NAME = /^[^/\\.]+$/;

/**
 * Каталоги слоёв приложения и слои поставщиков (D-107, D-111): чей файл и
 * какой слой; без `layout` — только раннеры и слои поставщиков. Ошибка
 * раскладки или слоя поставщика, нет каталога `project` — отказ в
 * конструкторе: проверки не проходят молча по пустому обходу.
 * @see src/arch/layer-checker.test.ts
 */
export class LayerMap {
  /** `ArchApp.project`, разрешённый в абсолютный путь: с ним сверяются каталоги и цели. */
  readonly project: string;
  /** Нарушения ARC-13: слой поставщика без каталога, каталог без слоя, каталог по шаблону без модуля. */
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
    if (!existsSync(this.project)) {
      throw new Error(`ArchApp.project — нет каталога: ${this.project}`);
    }
    for (const layer of FRAMEWORK_LAYERS) this.layers.set(layer.name, layer);
    this.declare(providers);
    this.places = this.locate(index.modules).sort(
      (a, b) => b.dir.length - a.dir.length,
    );
    this.issues = [...this.undeclared(), ...this.strays()];
  }

  /** Каталог слоя, которому принадлежит путь, или `undefined` — вне слоёв. */
  placeOf(path: string): LayerPlace | undefined {
    return this.places.find((place) => this.scan.inside(path, place.dir));
  }

  /**
   * Оси слоёв каталога (D-108): каталоги слоёв внутри `dir` и содержащие его.
   * Ось — по слою, не по имени каталога.
   */
  axesIn(dir: string): ReadonlySet<LayerAxis> {
    const at = resolve(dir);
    return new Set(
      this.places
        .filter(
          (p) => this.scan.inside(p.dir, at) || this.scan.inside(at, p.dir),
        )
        .map((p) => p.layer.axis),
    );
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
    for (const layer of declared) {
      const at = `ARC-13: слой ${layer.name} поставщика ${this.owners.get(layer.name)}`;
      this.verifyNames(layer, at);
      this.verifyEdges(layer, at);
    }
  }

  /** Модули поставщика (D-110) — имена каталогов без повторов; `entry` — имя файла. */
  private verifyNames(layer: SourceLayer, at: string): void {
    const seen = new Set<string>();
    for (const name of LayerMap.provided(layer) ?? []) {
      if (!SEGMENT.test(name) || name === '.' || name === '..') {
        throw new Error(`${at} — модуль «${name}» не имя каталога`);
      }
      if (seen.has(name)) throw new Error(`${at} — модуль ${name} дважды`);
      seen.add(name);
    }
    if (layer.entry !== undefined && !FILE_NAME.test(layer.entry)) {
      throw new Error(
        `${at} — entry «${layer.entry}» не имя файла без расширения`,
      );
    }
  }

  /**
   * Рёбра слоя поставщика: не к реализациям; `seenBy` — только слои
   * фреймворка; `others` — между слоями по модулям (D-110).
   */
  private verifyEdges(layer: SourceLayer, at: string): void {
    const closed = (edge: string, to: string): string =>
      `${at} — ${edge} к ${to}: слои реализаций поставщику недоступны`;
    for (const access of layer.sees) {
      const to = access.layer;
      if (IMPLEMENTATION_LAYERS.includes(to))
        throw new Error(closed('sees', to));
      if (!this.layers.has(to)) {
        throw new Error(`${at} — sees к неизвестному слою ${to}`);
      }
      this.verifyOthers(`${at} — sees к ${to}`, access, layer, this.layer(to));
    }
    for (const access of layer.seenBy ?? []) {
      const by = access.layer;
      if (IMPLEMENTATION_LAYERS.includes(by)) {
        throw new Error(closed('seenBy', by));
      }
      if (!FRAMEWORK_LAYERS.some((l) => l.name === by)) {
        throw new Error(`${at} — seenBy к ${by}: только к слоям dmg-core`);
      }
      this.verifyOthers(
        `${at} — seenBy к ${by}`,
        access,
        layer,
        this.layer(by),
      );
    }
  }

  // Объявленное поле, которое проверка не читает, — отказ, а не тихий пропуск:
  // у модулей поставщика нет `dependsOn`, при `none` `entries` не применяются.
  private verifyOthers(
    edge: string,
    { others, entries }: LayerAccess,
    ...ends: readonly SourceLayer[]
  ): void {
    if (others === undefined) return;
    if (ends.some((l) => l.perModule === undefined)) {
      throw new Error(`${edge} с others: оба слоя должны быть по модулям`);
    }
    if (others === 'none' && entries !== undefined) {
      throw new Error(
        `${edge} с others: 'none' и entries: чужой модуль закрыт, свой — через own или весь, entries не нужны`,
      );
    }
    if (
      others === 'dependsOn' &&
      ends.some((l) => LayerMap.provided(l) !== undefined)
    ) {
      throw new Error(
        `${edge} с others: 'dependsOn': у модулей поставщика нет dependsOn`,
      );
    }
  }

  /** Имена модулей поставщика; `undefined` — слой не по ним. */
  private static provided(layer: SourceLayer): readonly string[] | undefined {
    return layer.perModule === true ? undefined : layer.perModule;
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

  private locate(modules: readonly AnyModuleDef[]): LayerPlace[] {
    const { layout, runners } = this.app;
    const places: LayerPlace[] = [];
    if (layout !== undefined) this.addFramework(places, layout, modules);
    for (const dir of runners) this.add(places, 'runner', dir);
    for (const [name, dirs] of Object.entries(this.app.layers ?? {})) {
      if (!this.owners.has(name)) continue;
      for (const dir of dirs) this.addProvided(places, name, dir, modules);
    }
    return places;
  }

  // Модуль `app` занял бы каталог общего реализаций (D-106) — отказ по имени,
  // а не по совпавшим каталогам. Без `layout` каталога `backend/app` нет.
  private addFramework(
    places: LayerPlace[],
    layout: FrameworkDirs,
    modules: readonly AnyModuleDef[],
  ): void {
    if (modules.some((m) => m.name === 'app')) {
      throw new Error(
        'модуль app: каталог реализации совпадает с общим реализаций backend/app — имя зарезервировано (D-106)',
      );
    }
    const domain = this.template('ArchApp.layout.domain', layout.domain);
    const backend = this.template('ArchApp.layout.backend', layout.backend);
    this.add(places, 'kernel', layout.kernel);
    this.add(places, 'domain', this.rootOf(domain));
    for (const m of modules) {
      this.add(places, 'domain', this.fill(domain, m.name), m);
      this.add(places, 'backend', this.fill(backend, m.name), m);
    }
    this.add(places, 'backend-app', this.fill(backend, 'app'));
    this.add(places, 'assembly', layout.assembly);
  }

  /**
   * Каталог по шаблону без модуля (D-111): подкаталог корня шаблона на месте
   * `{m}`, в котором и которым не лежит ни один каталог слоя. Шаблоны с общим
   * корнем — одна строка на каталог; скрытые и `node_modules` не берутся.
   */
  private strays(): Violation[] {
    const roots = new Map<string, LayerTemplate[]>();
    for (const t of this.templates()) {
      roots.set(t.root, [...(roots.get(t.root) ?? []), t]);
    }
    return [...roots].flatMap(([root, templates]) =>
      this.subdirs(root).flatMap((name) => {
        const dir = join(root, name);
        const names = [
          ...new Set(
            templates.filter((t) => t.segment.test(name)).map((t) => t.layer),
          ),
        ];
        if (
          names.length === 0 ||
          this.places.some((p) => this.scan.inside(p.dir, dir))
        ) {
          return [];
        }
        const of =
          names.length === 1
            ? `слоя ${names[0]} — ${name} не модуль слоя`
            : `слоёв ${names.join(', ')} — ${name} не модуль этих слоёв`;
        return [
          new Violation('ARC-13', `каталог ${this.path(dir)} по шаблону ${of}`),
        ];
      }),
    );
  }

  /** Шаблоны с `{m}`: домена, `backend`, затем слоёв поставщиков по объявлению. */
  private templates(): LayerTemplate[] {
    const { layout, layers = {} } = this.app;
    const out: LayerTemplate[] = [];
    if (layout !== undefined) {
      out.push(this.split('domain', layout.domain));
      out.push(this.split('backend', layout.backend));
    }
    for (const name of this.owners.keys()) {
      if (this.layer(name).perModule === undefined) continue;
      for (const dir of layers[name] ?? []) out.push(this.split(name, dir));
    }
    return out;
  }

  /** Корень шаблона (`rootOf`) и сегмент с `{m}` регуляркой: `{m}` — любое имя. */
  private split(layer: string, template: string): LayerTemplate {
    const segment =
      resolve(template)
        .split(sep)
        .find((p) => p.includes(MODULE)) ?? MODULE;
    const pattern = segment
      .split(MODULE)
      .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.+');
    return {
      layer,
      root: this.rootOf(template),
      segment: new RegExp(`^${pattern}$`),
    };
  }

  /** Подкаталоги по имени, без скрытых и `node_modules`; нет каталога — пусто. */
  private subdirs(root: string): string[] {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.name.startsWith('.') &&
          d.name !== 'node_modules',
      )
      .map((d) => d.name)
      .sort();
  }

  /**
   * Каталог слоя поставщика (D-110): у слоя по модулям — шаблон с `{m}`, иначе
   * без. Модуль поставщика — только имя: одноимённый модуль `AppDef`
   * `external` и `dependsOn` ему не передаёт.
   */
  private addProvided(
    places: LayerPlace[],
    name: string,
    dir: string,
    modules: readonly AnyModuleDef[],
  ): void {
    const field = `ArchApp.layers.${name}`;
    const layer = this.layer(name);
    if (layer.perModule !== undefined) {
      const each = this.template(field, dir);
      const owned: readonly LayerModule[] =
        LayerMap.provided(layer)?.map((m) => ({ name: m })) ?? modules;
      for (const m of owned) this.add(places, name, this.fill(each, m.name), m);
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
    module?: LayerModule,
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
