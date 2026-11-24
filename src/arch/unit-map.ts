import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SourceScan } from './source-scan';
import type { Unit } from './unit-map.types';

/** Поля `package.json`, которые читает список единиц; `exports` — нет (D-108). */
type Manifest = {
  readonly name?: unknown;
  readonly workspaces?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
};

/**
 * Единицы выноса проекта (D-108) — пакеты из `workspaces` корневого
 * `package.json`. Нет файла или поля — единиц нет; пакет без `name` — отказ.
 * @see src/arch/unit-map.test.ts
 */
export class UnitMap {
  private readonly scan = new SourceScan();
  /** От самого глубокого каталога: путь принадлежит первой, что его содержит. */
  private readonly deepest: readonly Unit[];

  private constructor(readonly units: readonly Unit[]) {
    this.deepest = [...units].sort((a, b) => b.dir.length - a.dir.length);
  }

  static read(project: string): UnitMap {
    const root = resolve(project);
    const file = join(root, 'package.json');
    if (!existsSync(file)) return new UnitMap([]);
    const patterns = UnitMap.patterns(UnitMap.manifest(file).workspaces);
    const include = patterns.filter((p) => !p.startsWith('!'));
    const exclude = patterns
      .filter((p) => p.startsWith('!'))
      .map((p) => new Bun.Glob(`${UnitMap.trim(p.slice(1))}/package.json`));
    const found = new Set<string>();
    for (const pattern of include) {
      const glob = new Bun.Glob(`${UnitMap.trim(pattern)}/package.json`);
      for (const path of glob.scanSync({ cwd: root })) {
        const rel = path.split(sep).join('/');
        if (rel.split('/').includes('node_modules')) continue;
        if (exclude.some((g) => g.match(rel))) continue;
        found.add(rel);
      }
    }
    return new UnitMap(
      [...found]
        .map((rel) => UnitMap.unit(root, rel))
        .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)),
    );
  }

  /** Единица самого глубокого каталога, содержащего путь, или `undefined`. */
  unitOf(path: string): Unit | undefined {
    return this.deepest.find((unit) => this.scan.inside(path, unit.dir));
  }

  named(name: string): Unit | undefined {
    return this.units.find((unit) => unit.name === name);
  }

  /** `workspaces` — массив шаблонов или `{ packages }`; иное — без единиц. */
  private static patterns(workspaces: unknown): string[] {
    const list =
      typeof workspaces === 'object' &&
      workspaces !== null &&
      'packages' in workspaces
        ? workspaces.packages
        : workspaces;
    return Array.isArray(list)
      ? list.filter((p): p is string => typeof p === 'string')
      : [];
  }

  /** Шаблон без `./` в начале и `/` в конце: к нему дописывается `/package.json`. */
  private static trim(pattern: string): string {
    return pattern.replace(/^\.\//, '').replace(/\/+$/, '');
  }

  private static unit(root: string, rel: string): Unit {
    const manifest = UnitMap.manifest(join(root, rel));
    const dir = dirname(join(root, rel));
    if (typeof manifest.name !== 'string') {
      throw new Error(
        `${relative(root, dir).split(sep).join('/')}/package.json пакета workspaces без name`,
      );
    }
    const names = (deps?: Readonly<Record<string, string>>): string[] =>
      Object.keys(deps ?? {});
    return {
      dir,
      name: manifest.name,
      working: new Set([
        ...names(manifest.dependencies),
        ...names(manifest.peerDependencies),
      ]),
      dev: new Set(names(manifest.devDependencies)),
    };
  }

  private static manifest(file: string): Manifest {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
}
