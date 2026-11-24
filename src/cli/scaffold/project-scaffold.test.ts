import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPlan } from '../../gen/apply';
import { GenError } from '../../gen/cli';
import type { GenPlan } from '../../gen/plan';
import { CliConfig } from '../cli-config';
import { PackageSource } from '../package-source';
import { ProjectScaffold } from './project-scaffold';

// Каркас проекта `single` — план файлов: состав, конфиги и применение
// существующим `applyPlan` (без перезаписи).

const PACKAGE_ROOT = join(import.meta.dir, '../../..');
const NAME = 'acme';

const SINGLE_FILES = [
  '.gitignore',
  'package.json',
  'tsconfig.json',
  'biome.json',
  'dmg-core.json',
  'scripts/arch-check.ts',
  'scripts/acme.graph.ts',
  'src/platform/domain/acme.app.ts',
  'src/platform/kernel/app-user.ts',
  'src/runners/assembly/app.ts',
  'src/runners/assembly/app.types.ts',
  'src/runners/assembly/app-caller-resolver.ts',
  'src/runners/assembly/app.test.ts',
  'src/runners/cli/main.ts',
  'src/runners/cli/main.test.ts',
  'src/runners/cli/runner-cli.ts',
  'src/runners/cli/runner-cli.types.ts',
  'src/runners/cli/runner-cli.test.ts',
  'src/runners/cli/runner-env.ts',
  'src/runners/cli/runner-env.types.ts',
  'src/runners/cli/runner-env.test.ts',
];

let pkg: PackageSource;
beforeAll(async () => {
  pkg = await PackageSource.load(PACKAGE_ROOT);
});

function plan(root?: string): GenPlan {
  return new ProjectScaffold({
    profile: 'single',
    name: NAME,
    pkg,
    root,
  }).plan();
}

function file(path: string, root?: string): string {
  const found = plan(root).files.find((f) => f.path === path);
  if (found === undefined) throw new Error(`Нет файла в плане: ${path}`);
  return found.content;
}

function json(path: string) {
  return JSON.parse(file(path));
}

describe('ProjectScaffold single: состав плана', () => {
  it('все файлы каркаса, правок нет', () => {
    const res = plan();

    expect(res.files.map((f) => f.path).sort()).toEqual(
      [...SINGLE_FILES].sort(),
    );
    expect(res.edits).toEqual([]);
  });

  it('пути — от переданного root', () => {
    const paths = plan('/work/acme').files.map((f) => f.path);

    expect(paths).toContain('/work/acme/src/runners/assembly/app.ts');
    expect(paths.every((p) => p.startsWith('/work/acme/'))).toBe(true);
  });

  it('имя проекта не по правилам npm — GenError (ошибка ввода CLI)', () => {
    for (const name of ['', 'Acme', 'a b', '../x']) {
      const create = () =>
        new ProjectScaffold({ profile: 'single', name, pkg });
      expect(create).toThrow(GenError);
      expect(create).toThrow(`Имя проекта «${name}» — не имя пакета npm`);
    }
    for (const name of ['acme', '@acme/school', 'my-app']) {
      expect(
        () => new ProjectScaffold({ profile: 'single', name, pkg }),
      ).not.toThrow();
    }
  });

  it('имя без scope не годится в имя приложения — GenError с именем и правилом', () => {
    // `@acme/_x` отсекает уже правило имени пакета npm — тоже отказ.
    expect(
      () => new ProjectScaffold({ profile: 'single', name: '@acme/_x', pkg }),
    ).toThrow(GenError);
    for (const name of ['acme.io', '1school']) {
      const create = () =>
        new ProjectScaffold({ profile: 'single', name, pkg });
      expect(create).toThrow(GenError);
      expect(create).toThrow(`Имя проекта «${name}» не годится`);
      expect(create).toThrow('^[a-z][a-z0-9-]*$');
    }
  });
});

describe('ProjectScaffold single: package.json', () => {
  it('имя, private, type module', () => {
    expect(json('package.json')).toMatchObject({
      name: NAME,
      private: true,
      type: 'module',
    });
  });

  it('version 0.1.0 — по умолчанию, команде graph нужна версия приложения', () => {
    expect(json('package.json').version).toBe('0.1.0');
  });

  it('скрипты check, arch:check, graph, lint, format', () => {
    expect(json('package.json').scripts).toEqual({
      'arch:check': 'bun scripts/arch-check.ts',
      graph: 'dmg-core graph scripts/acme.graph.ts',
      check:
        'dmg-core sync --check && biome check . && tsc --noEmit && bun run arch:check && bun test',
      lint: 'biome check .',
      format: 'biome check . --write',
    });
  });

  it('версии зависимостей — из PackageSource', () => {
    const manifest = json('package.json');

    expect(manifest.dependencies).toEqual({
      'dmg-core': `^${pkg.version}`,
      valibot: pkg.peerDependencies.valibot,
      '@valibot/to-json-schema':
        pkg.peerDependencies['@valibot/to-json-schema'],
    });
    expect(manifest.devDependencies).toEqual({
      '@biomejs/biome': pkg.devDependencies['@biomejs/biome'],
      typescript: pkg.devDependencies.typescript,
      '@types/bun': pkg.devDependencies['@types/bun'],
    });
  });
});

describe('ProjectScaffold single: прочие конфиги', () => {
  it('.gitignore — зависимости, каталог данных и graph.json (артефакт сборки)', () => {
    expect(file('.gitignore')).toBe('node_modules/\ndata/\ngraph.json\n');
  });

  it('acme.graph.ts — вход dmg-core graph: GraphApp с AppDef, без поставщиков', () => {
    const src = file('scripts/acme.graph.ts');

    expect(src).toContain("import type { GraphApp } from 'dmg-core/graph';");
    expect(src).toContain(
      "import { AcmeAppDef } from '../src/platform/domain/acme.app';",
    );
    expect(src).toContain(
      'export default { def: AcmeAppDef } satisfies GraphApp;',
    );
    expect(src).toContain('providers');
  });

  it('tsconfig — как у пакета, include src и scripts', () => {
    const tsconfig = json('tsconfig.json');

    expect(tsconfig.include).toEqual(['src', 'scripts']);
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noEmit: true,
      moduleResolution: 'bundler',
      verbatimModuleSyntax: true,
      noUncheckedIndexedAccess: true,
    });
  });

  it('dmg-core.json — все ключи осей gen в порядке полей, разбирается parse', () => {
    const config = new CliConfig(pkg);
    const data = json('dmg-core.json');
    const gen = {
      domain: 'src/platform/domain/{m}',
      backend: 'src/backend/{m}',
      kernel: 'src/platform/kernel',
      assembly: 'src/runners/assembly',
      appDef: 'src/platform/domain/acme.app.ts',
    };

    expect(data).toEqual({ ...config.defaults(), gen });
    expect(Object.keys(data.gen)).toEqual(Object.keys(gen));
    expect(config.parse(data).gen).toEqual(gen);
  });

  it('arch-check.ts — каталоги слоёв из GenLayout.dirs(), проект и раннер', () => {
    const src = file('scripts/arch-check.ts');

    expect(src).toContain("import { GenLayout } from 'dmg-core/gen'");
    expect(src).toContain('await GenLayout.read(');
    expect(src).toContain("import AcmeGraph from './acme.graph';");
    expect(src).toContain('...AcmeGraph,');
    expect(src).toContain("entry: 'contract',");
    expect(src).toContain('project: root,');
    expect(src).toContain('layout: layout.dirs(),');
    expect(src).toContain("runners: [join(root, 'src/runners/cli')]");
    expect(src).toContain("graphEntry: join(root, 'scripts/acme.graph.ts'),");
    expect(src).not.toContain('layout.module');
    expect(src).not.toContain('root: join(');
    expect(src).not.toContain("'src/runners/assembly'");
    expect(src).not.toContain('def:');
    expect(src).not.toContain('AcmeAppDef');
    expect(src).not.toContain("ArchApp['modules']");
    expect(src).not.toContain('gen:');
    expect(src).not.toContain('name:');
    expect(src).toContain('reportArchCheck(');
    expect(src).toContain("strict: process.argv.includes('--strict')");
  });

  it('acme.app.ts — AppDef с маркерами подключения модулей и TODO в текстах', () => {
    const src = file('src/platform/domain/acme.app.ts');

    expect(src).toContain(
      "import { AppDef } from 'dmg-core';\n// gen:imports\n",
    );
    expect(src).toContain('export const AcmeAppDef = AppDef.define({');
    expect(src).toContain("name: 'acme'");
    expect(src).toContain("label: 'TODO: название приложения'");
    expect(src).toContain("description: 'TODO: что делает приложение'");
    expect(src).toContain('modules: [\n    // gen:modules\n  ]');
  });

  it('app.ts — маркеры подключения модулей для gen module/aggregate', () => {
    const src = file('src/runners/assembly/app.ts');

    expect(src).toContain("from './app-caller-resolver';\n// gen:imports\n");
    expect(src).toContain(
      'const modules: ModuleFactory<AppUser>[] = [\n      // gen:modules\n    ];',
    );
  });

  it('сборка импортирует AppUser из kernel, раннер — App из сборки', () => {
    expect(file('src/runners/assembly/app.ts')).toContain(
      "import type { AppUser } from '../../platform/kernel/app-user';",
    );
    expect(file('src/runners/cli/main.ts')).toContain("from '../assembly/app'");
  });

  it('biome.json — каталог данных вне проверки: запуск раннера не ломает check', () => {
    expect(json('biome.json').files).toEqual({
      ignoreUnknown: true,
      includes: ['**', '!!data'],
    });
  });

  it('biome.json — схема версии biome пакета', () => {
    expect(json('biome.json').$schema).toBe(
      `https://biomejs.dev/schemas/${pkg.devDependencies['@biomejs/biome']}/schema.json`,
    );
  });
});

describe('ProjectScaffold single: применение', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scaffold-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('план записывается во временный каталог целиком', () => {
    const res = applyPlan(plan(dir), { write: true });

    expect(res.written).toHaveLength(SINGLE_FILES.length);
    for (const path of SINGLE_FILES) {
      expect(existsSync(join(dir, path))).toBe(true);
    }
  });

  it('без write план ничего не пишет', () => {
    applyPlan(plan(dir), { write: false });

    expect(readdirSync(dir)).toEqual([]);
  });

  it('повтор — ошибка коллизии, ничего не записано', () => {
    applyPlan(plan(dir), { write: true });
    rmSync(join(dir, 'src/runners/cli'), { recursive: true });

    expect(() => applyPlan(plan(dir), { write: true })).toThrow(GenError);
    expect(existsSync(join(dir, 'src/runners/cli'))).toBe(false);
  });
});
