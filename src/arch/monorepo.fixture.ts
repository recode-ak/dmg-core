import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { FixtureManifest, FixtureSection } from './monorepo.fixture.types';

/** Секции зависимостей `package.json`: имена пакетов, версии ставит фикстура. */
const SECTIONS: readonly FixtureSection[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * Мини-монорепо на изолированной установке Bun (D-108, D-111): `<base>/proj` —
 * проект, `<base>/vendor/<имя>` — внешние пакеты; зависимости — `workspace:*`
 * и `file:`, офлайн. Кэш резолвера Bun живёт весь процесс и не забывает
 * разрешений: сценарий — в своём каталоге, фикстура — целиком до `install()`.
 * @see src/arch/unit-checker.test.ts
 */
export class Monorepo {
  /** Абсолютный путь проекта (`ArchApp.project`), без ссылок. */
  readonly proj: string;
  private readonly vendors = new Map<string, string>();
  private installed = false;

  private constructor(readonly base: string) {
    this.proj = join(base, 'proj');
    mkdirSync(this.proj);
  }

  static create(): Monorepo {
    return new Monorepo(
      realpathSync(mkdtempSync(join(tmpdir(), 'arch-units-'))),
    );
  }

  /** Корневой `package.json` проекта. */
  root(manifest: FixtureManifest): this {
    return this.json('package.json', this.manifest(manifest));
  }

  /** `package.json` пакета в каталоге `dir` (от проекта). Vendor — объявлять раньше. */
  unit(dir: string, manifest: FixtureManifest): this {
    return this.json(join(dir, 'package.json'), this.manifest(manifest));
  }

  /** Внешний пакет вне проекта; без `exports` любой подпуть — его поверхность. */
  vendor(
    name: string,
    files: Readonly<Record<string, string>> = { 'index.ts': 'export {};\n' },
    exports?: Readonly<Record<string, string>>,
  ): this {
    this.guard();
    const dir = join(this.base, 'vendor', name);
    const manifest = {
      name,
      version: '1.0.0',
      main: 'index.ts',
      ...(exports === undefined ? {} : { exports }),
    };
    this.put(
      join(dir, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    for (const [file, text] of Object.entries(files)) {
      this.put(join(dir, file), text);
    }
    this.vendors.set(name, dir);
    return this;
  }

  /** Файл проекта: по импорту на спецификатор, в порядке аргументов. */
  write(path: string, ...specs: readonly string[]): this {
    const lines = specs.map((spec, i) => `import { v${i} } from '${spec}';`);
    return this.file(path, [...lines, 'export {};', ''].join('\n'));
  }

  /** Файл проекта с заданным текстом. */
  file(path: string, text: string): this {
    this.put(join(this.proj, path), text);
    return this;
  }

  /** `bun install` офлайн, изолированным линкером, без lockfile; отказ — `Error` с stderr. */
  install(): void {
    this.guard();
    const proc = Bun.spawnSync(
      [
        process.execPath,
        'install',
        '--offline',
        '--linker',
        'isolated',
        '--no-save',
      ],
      {
        cwd: this.proj,
        // Окружение — только своё: кэш установки в каталоге фикстуры, не общий.
        env: { BUN_INSTALL_CACHE_DIR: join(this.base, 'cache') },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    if (proc.exitCode !== 0) {
      throw new Error(
        `Monorepo: bun install — код ${proc.exitCode}: ${proc.stderr.toString()}`,
      );
    }
    this.installed = true;
  }

  dispose(): void {
    rmSync(this.base, { recursive: true, force: true });
  }

  private manifest(manifest: FixtureManifest): Record<string, unknown> {
    const { name, exports, imports, workspaces } = manifest;
    const out: Record<string, unknown> = { name, version: '1.0.0' };
    if (workspaces !== undefined) out.workspaces = workspaces;
    if (exports !== undefined) out.exports = exports;
    if (imports !== undefined) out.imports = imports;
    for (const section of SECTIONS) {
      const names = manifest[section];
      if (names === undefined) continue;
      out[section] = Object.fromEntries(
        names.map((dep) => [dep, this.version(dep)]),
      );
    }
    return out;
  }

  private version(dep: string): string {
    const dir = this.vendors.get(dep);
    return dir === undefined ? 'workspace:*' : `file:${dir}`;
  }

  private json(path: string, data: Record<string, unknown>): this {
    return this.file(path, `${JSON.stringify(data, null, 2)}\n`);
  }

  private put(path: string, text: string): void {
    this.guard();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  private guard(): void {
    if (this.installed) {
      throw new Error(
        'Monorepo: фикстура меняется после install() — кэш резолвера Bun этого не увидит',
      );
    }
  }
}
