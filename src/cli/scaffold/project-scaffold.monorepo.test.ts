import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPlan } from '../../gen/apply';
import type { GenPlan } from '../../gen/plan';
import { CliConfig } from '../cli-config';
import { PackageSource } from '../package-source';
import { ProjectScaffold } from './project-scaffold';

// Каркас проекта `monorepo` — план файлов: корень с workspaces, пакеты
// kernel, домена, сборки и раннера CLI; конфиги и применение `applyPlan`.

const PACKAGE_ROOT = join(import.meta.dir, '../../..');
const NAME = 'acme';

const MONOREPO_FILES = [
  '.gitignore',
  'package.json',
  'tsconfig.json',
  'biome.json',
  'dmg-core.json',
  'scripts/arch-check.ts',
  'scripts/acme.graph.ts',
  'platform/kernel/package.json',
  'platform/kernel/tsconfig.json',
  'platform/kernel/src/index.ts',
  'platform/kernel/src/app-user.ts',
  'platform/domain/package.json',
  'platform/domain/tsconfig.json',
  'platform/domain/src/index.ts',
  'platform/domain/src/acme.app.ts',
  'runners/assembly/package.json',
  'runners/assembly/tsconfig.json',
  'runners/assembly/src/index.ts',
  'runners/assembly/src/app.ts',
  'runners/assembly/src/app.types.ts',
  'runners/assembly/src/app-caller-resolver.ts',
  'runners/assembly/src/app.test.ts',
  'runners/cli/package.json',
  'runners/cli/tsconfig.json',
  'runners/cli/src/main.ts',
  'runners/cli/src/main.test.ts',
  'runners/cli/src/runner-cli.ts',
  'runners/cli/src/runner-cli.types.ts',
  'runners/cli/src/runner-cli.test.ts',
  'runners/cli/src/runner-env.ts',
  'runners/cli/src/runner-env.types.ts',
  'runners/cli/src/runner-env.test.ts',
];

let pkg: PackageSource;
beforeAll(async () => {
  pkg = await PackageSource.load(PACKAGE_ROOT);
});

function plan(name = NAME, root?: string): GenPlan {
  return new ProjectScaffold({ profile: 'monorepo', name, pkg, root }).plan();
}

function file(path: string, name = NAME): string {
  const found = plan(name).files.find((f) => f.path === path);
  if (found === undefined) throw new Error(`Нет файла в плане: ${path}`);
  return found.content;
}

function json(path: string, name = NAME) {
  return JSON.parse(file(path, name));
}

describe('ProjectScaffold monorepo: состав плана', () => {
  it('все файлы каркаса, правок нет; каталога backend в плане нет', () => {
    const res = plan();

    expect(res.files.map((f) => f.path).sort()).toEqual(
      [...MONOREPO_FILES].sort(),
    );
    expect(res.edits).toEqual([]);
  });
});

describe('ProjectScaffold monorepo: scope пакетов', () => {
  it('имя без scope: acme → @acme/*', () => {
    expect(json('package.json').name).toBe('acme');
    expect(json('platform/kernel/package.json').name).toBe('@acme/kernel');
    expect(json('platform/domain/package.json').name).toBe('@acme/domain');
    expect(json('runners/assembly/package.json').name).toBe('@acme/assembly');
    expect(json('runners/cli/package.json').name).toBe('@acme/cli');
  });

  it('имя со scope: @acme/school → @acme/*, корень — имя как есть', () => {
    const name = '@acme/school';

    expect(json('package.json', name).name).toBe('@acme/school');
    expect(json('platform/kernel/package.json', name).name).toBe(
      '@acme/kernel',
    );
    expect(json('platform/domain/package.json', name).name).toBe(
      '@acme/domain',
    );
    expect(json('runners/cli/package.json', name).name).toBe('@acme/cli');
  });
});

describe('ProjectScaffold monorepo: package.json', () => {
  it('корень: private, type module, workspaces, скрипты check', () => {
    expect(json('package.json')).toMatchObject({
      private: true,
      type: 'module',
      workspaces: ['platform/*', 'backend/*', 'runners/*'],
      version: '0.1.0',
      scripts: {
        'arch:check': 'bun scripts/arch-check.ts',
        graph: 'dmg-core graph scripts/acme.graph.ts',
        check:
          'dmg-core sync --check && biome check . && tsc --noEmit && bun run arch:check && bun test',
        lint: 'biome check .',
        format: 'biome check . --write',
      },
    });
  });

  it('корень: dmg-core, его peer-зависимости, инструменты check и домен — dev', () => {
    const manifest = json('package.json');

    expect(manifest.dependencies).toBeUndefined();
    // Домен — для scripts/arch-check.ts: bun ≥1.3 не поднимает пакеты
    // workspaces в корневой node_modules без явной зависимости корня.
    expect(manifest.devDependencies).toEqual({
      'dmg-core': `^${pkg.version}`,
      valibot: pkg.peerDependencies.valibot,
      '@valibot/to-json-schema':
        pkg.peerDependencies['@valibot/to-json-schema'],
      '@biomejs/biome': pkg.devDependencies['@biomejs/biome'],
      typescript: pkg.devDependencies.typescript,
      '@types/bun': pkg.devDependencies['@types/bun'],
      '@acme/domain': 'workspace:*',
    });
  });

  it('kernel: вход src/index.ts, зависимости dmg-core и valibot', () => {
    expect(json('platform/kernel/package.json')).toEqual({
      name: '@acme/kernel',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' },
      scripts: { test: 'bun test --pass-with-no-tests' },
      dependencies: {
        'dmg-core': `^${pkg.version}`,
        valibot: pkg.peerDependencies.valibot,
      },
    });
  });

  it('домен: exports входов модулей, зависимости dmg-core и valibot', () => {
    expect(json('platform/domain/package.json')).toEqual({
      name: '@acme/domain',
      private: true,
      type: 'module',
      exports: {
        '.': './src/index.ts',
        './*/contract': './src/*/contract.ts',
        './*/testing': './src/*/testing.ts',
        './*': './src/*/index.ts',
      },
      scripts: { test: 'bun test --pass-with-no-tests' },
      dependencies: {
        'dmg-core': `^${pkg.version}`,
        valibot: pkg.peerDependencies.valibot,
      },
    });
  });

  it('сборка: вход src/index.ts, домен и kernel — workspace:*', () => {
    expect(json('runners/assembly/package.json')).toEqual({
      name: '@acme/assembly',
      private: true,
      type: 'module',
      exports: { '.': './src/index.ts' },
      scripts: { test: 'bun test --pass-with-no-tests' },
      dependencies: {
        'dmg-core': `^${pkg.version}`,
        '@acme/domain': 'workspace:*',
        '@acme/kernel': 'workspace:*',
      },
    });
  });

  it('раннер CLI: домен и сборка — workspace:*, valibot — проверка --user', () => {
    expect(json('runners/cli/package.json')).toEqual({
      name: '@acme/cli',
      private: true,
      type: 'module',
      scripts: { test: 'bun test --pass-with-no-tests' },
      dependencies: {
        'dmg-core': `^${pkg.version}`,
        valibot: pkg.peerDependencies.valibot,
        '@acme/domain': 'workspace:*',
        '@acme/assembly': 'workspace:*',
      },
    });
  });
});

describe('ProjectScaffold monorepo: tsconfig', () => {
  it('корень: src всех пакетов и scripts', () => {
    const tsconfig = json('tsconfig.json');

    expect(tsconfig.include).toEqual([
      'platform/*/src',
      'backend/*/src',
      'runners/*/src',
      'scripts',
    ]);
    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noEmit: true,
      moduleResolution: 'bundler',
    });
  });

  it('пакеты: extends корневого, include src', () => {
    for (const dir of [
      'platform/kernel',
      'platform/domain',
      'runners/assembly',
      'runners/cli',
    ]) {
      expect(json(`${dir}/tsconfig.json`)).toEqual({
        extends: '../../tsconfig.json',
        include: ['src'],
      });
    }
  });
});

describe('ProjectScaffold monorepo: прочие конфиги', () => {
  it('dmg-core.json — все ключи осей gen в порядке полей (пакет be-{m}), разбирается parse', () => {
    const config = new CliConfig(pkg);
    const data = json('dmg-core.json');
    const gen = {
      domain: 'platform/domain/src/{m}',
      backend: 'backend/{m}/src',
      kernel: 'platform/kernel/src',
      domainImport: '@acme/domain/{m}',
      package: '@acme/be-{m}',
      assembly: 'runners/assembly/src',
      appDef: 'platform/domain/src/acme.app.ts',
    };

    expect(data).toEqual({ ...config.defaults(), gen });
    expect(Object.keys(data.gen)).toEqual(Object.keys(gen));
    expect(config.parse(data).gen).toEqual(gen);
  });

  it('arch-check.ts — каталоги слоёв из GenLayout.dirs(), раннер runners/cli/src', () => {
    const src = file('scripts/arch-check.ts');

    expect(src).toContain('project: root,');
    expect(src).toContain('layout: layout.dirs(),');
    expect(src).toContain("runners: [join(root, 'runners/cli/src')]");
    expect(src).not.toContain('root: join(');
    expect(src).not.toContain("'runners/assembly/src'");
  });

  it('acme.graph.ts — вход dmg-core graph: AppDef из @acme/domain', () => {
    const src = file('scripts/acme.graph.ts');

    expect(src).toContain("import type { GraphApp } from 'dmg-core/graph';");
    expect(src).toContain("import { AcmeAppDef } from '@acme/domain';");
    expect(src).toContain(
      'export default { def: AcmeAppDef } satisfies GraphApp;',
    );
    expect(src).toContain('providers');
  });

  it('имя со scope: вход графа — scripts/school.graph.ts, скрипт graph', () => {
    const name = '@acme/school';

    expect(file('scripts/school.graph.ts', name)).toContain(
      "import { SchoolAppDef } from '@acme/domain';",
    );
    expect(json('package.json', name).scripts.graph).toBe(
      'dmg-core graph scripts/school.graph.ts',
    );
  });

  it('имя со scope: AppDef — school, файл platform/domain/src/school.app.ts, gen.appDef', () => {
    const name = '@acme/school';

    expect(file('platform/domain/src/school.app.ts', name)).toContain(
      "export const SchoolAppDef = AppDef.define({\n  name: 'school',",
    );
    expect(json('dmg-core.json', name).gen.appDef).toBe(
      'platform/domain/src/school.app.ts',
    );
    expect(file('scripts/arch-check.ts', name)).toContain(
      "import SchoolGraph from './school.graph';",
    );
  });

  it('вход домена — только AppDef приложения, без AppUser', () => {
    const src = file('platform/domain/src/index.ts');

    expect(src).toContain("export { AcmeAppDef } from './acme.app';");
    expect(src).not.toContain('AppUser');
  });

  it('biome.json — плагины на каталогах пакетов', () => {
    const overrides: { includes: string[]; plugins?: string[] }[] =
      json('biome.json').overrides;
    const includesOf = (plugin: string) =>
      overrides.find((o) => o.plugins?.some((p) => p.endsWith(`/${plugin}`)))
        ?.includes;

    expect(includesOf('dom-14-no-clock.grit')).toEqual([
      'platform/domain/src/**',
      '!**/*.test.ts',
    ]);
    expect(includesOf('arc-09-no-env.grit')).toEqual([
      'platform/*/src/**',
      'backend/*/src/**',
      'runners/*/src/**',
      '!runners/*/src/main.ts',
      '!**/*.test.ts',
    ]);
    expect(includesOf('err-01-no-throw.grit')).toContain(
      'backend/*/src/**/*.uc.ts',
    );
  });
});

describe('ProjectScaffold monorepo: исходники', () => {
  it('тип пользователя — из @acme/kernel, сборка — из @acme/assembly', () => {
    expect(file('runners/assembly/src/app.ts')).toContain(
      "import type { AppUser } from '@acme/kernel';",
    );
    expect(file('runners/cli/src/main.ts')).toContain(
      "import { App, type AppEnv } from '@acme/assembly';",
    );
    expect(file('runners/cli/src/runner-cli.ts')).toContain(
      "import type { App } from '@acme/assembly';",
    );
  });

  it('входы пакетов kernel и сборки реэкспортируют их API', () => {
    expect(file('platform/kernel/src/index.ts')).toContain(
      "export type { AppUser } from './app-user';",
    );
    expect(file('runners/assembly/src/index.ts')).toContain(
      "export { App } from './app';",
    );
  });
});

describe('ProjectScaffold monorepo: применение', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scaffold-monorepo-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('план записывается во временный каталог целиком', () => {
    const res = applyPlan(plan(NAME, dir), { write: true });

    expect(res.written).toHaveLength(MONOREPO_FILES.length);
    for (const path of MONOREPO_FILES) {
      expect(existsSync(join(dir, path))).toBe(true);
    }
  });
});
