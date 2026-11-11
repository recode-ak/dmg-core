import { dirname, join, relative, sep } from 'node:path';
import type { AnyModuleDef } from '../domain/contracts/module-def';
import type { DefIndex } from '../graph/def-index';
import type { AssemblyPlaces } from './assembly-checker.types';
import { DomainEntries } from './domain-entries';
import type { EntryMisuse } from './domain-entries.types';
import type { ModuleLayout } from './file-checker';
import { SourceScan } from './source-scan';
import { type ArchRule, Violation } from './violation';

/** Слой приложения, чьи импорты проверяются: правило и имя в сообщении. */
type Side = {
  readonly rule: ArchRule;
  readonly title: string;
  readonly base: string;
  /** Импорт прикладного пакета: можно ли через его `index`. */
  readonly appEntry: boolean;
  /** Каталоги внутри `base`, файлы которых — не этот слой. */
  readonly skip: readonly string[];
};

/**
 * Импорты корня сборки (ARC-07) и раннеров (ARC-08), а также прикладного
 * пакета модуля в их сторону (ARC-06), D-52. Отдельно от `FileChecker`:
 * тот — файлы модулей между собой, этот — связи с приложением вокруг них.
 * @see src/arch/assembly-checker.test.ts
 */
export class AssemblyChecker {
  private readonly scan = new SourceScan();
  private readonly entries: DomainEntries;

  constructor(
    private readonly index: DefIndex,
    private readonly layout: (module: string) => ModuleLayout,
    entry: string,
    private readonly places: AssemblyPlaces,
    testing = 'testing',
  ) {
    this.entries = new DomainEntries(entry, testing);
  }

  check(): Violation[] {
    const modules = this.index.modules.map(
      (m) => [m, this.layout(m.name)] as const,
    );
    const runners = this.places.runners ?? [];
    const sides: Side[] = runners.map((base) => ({
      rule: 'ARC-08',
      title: 'раннер',
      base,
      appEntry: false,
      skip: [],
    }));
    if (this.places.root !== undefined) {
      sides.unshift({
        rule: 'ARC-07',
        title: 'корень сборки',
        base: this.places.root,
        appEntry: true,
        skip: [
          ...modules.flatMap(([, dir]) => [dir.domain, dir.app]),
          ...runners,
        ],
      });
    }
    const from = this.ancestor(sides.map((side) => dirname(side.base)));
    return [
      ...sides.flatMap((side) => this.checkSide(side, modules, from)),
      ...modules.flatMap(([m, dir]) =>
        m.external === true ? [] : this.checkApp(m, dir.app, sides),
      ),
    ];
  }

  private checkSide(
    side: Side,
    modules: readonly (readonly [AnyModuleDef, ModuleLayout])[],
    from: string,
  ): Violation[] {
    const out: Violation[] = [];
    for (const f of this.scan.files(side.base)) {
      const file = join(side.base, f);
      if (side.skip.some((dir) => this.scan.inside(file, dir))) continue;
      const where = `${side.title} ${this.path(from, file)}`;
      for (const { spec, target } of this.scan.imports(file)) {
        for (const [m, dir] of modules) {
          const misuse = this.misuse(side, m, dir, f, target);
          if (misuse !== undefined) {
            out.push(
              new Violation(
                misuse.testing ? 'TST-07' : side.rule,
                `${where} ${misuse.message}: ${spec}`,
              ),
            );
          }
        }
      }
    }
    return out;
  }

  /** ARC-06: файлы прикладного пакета `m` не импортируют корень и раннеры. */
  private checkApp(
    m: AnyModuleDef,
    app: string,
    sides: readonly Side[],
  ): Violation[] {
    const out: Violation[] = [];
    for (const f of this.scan.files(app)) {
      for (const { spec, target } of this.scan.imports(join(app, f))) {
        // Пакеты модулей и раннеры внутри корня — в `skip` корня.
        const side = sides.find(
          (s) =>
            this.scan.inside(target, s.base) &&
            !s.skip.some((dir) => this.scan.inside(target, dir)),
        );
        if (side !== undefined) {
          out.push(
            new Violation(
              'ARC-06',
              `${m.name}/${f} импортирует ${side.title}: ${spec}`,
            ),
          );
        }
      }
    }
    return out;
  }

  /** Путь файла от `from` через `/` — место в сообщении. */
  private path(from: string, file: string): string {
    return relative(from, file).split(sep).join('/');
  }

  /** Общий предок каталогов (`dirs` не пуст, иначе — корень ФС). */
  private ancestor(dirs: readonly string[]): string {
    const [first = [], ...rest] = dirs.map((d) => d.split(sep));
    let n = first.length;
    for (const parts of rest) {
      let i = 0;
      while (i < n && parts[i] === first[i]) i++;
      n = i;
    }
    return first.slice(0, n).join(sep) || sep;
  }

  /**
   * Почему импорт `target` модуля `m` запрещён файлу `file` слоя, или
   * `undefined`.
   */
  private misuse(
    side: Side,
    m: AnyModuleDef,
    dir: ModuleLayout,
    file: string,
    target: string,
  ): EntryMisuse | undefined {
    if (this.scan.inside(target, dir.domain)) {
      return this.entries.misuse(file, target, dir.domain, m.name);
    }
    if (m.external === true || !this.scan.inside(target, dir.app)) {
      return undefined;
    }
    const app = (message: string): EntryMisuse => ({ testing: false, message });
    if (!side.appEntry) return app(`импортирует прикладной пакет ${m.name}`);
    return this.scan.isEntry(target, dir.app, 'index')
      ? undefined
      : app(`импортирует прикладной пакет ${m.name} мимо index.ts`);
  }
}
