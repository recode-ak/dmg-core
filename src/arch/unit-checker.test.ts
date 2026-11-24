import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type AnyModuleDef, ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import type { GraphProvider } from '../graph/graph-provider';
import type { SourceLayer } from '../graph/source-layer.types';
import { AlphaModuleDef, BetaModuleDef, LayerProvider } from './arch.fixture';
import type { LayerPlaces } from './layer-checker.types';
import { LayerMap } from './layer-map';
import { Monorepo } from './monorepo.fixture';
import type { FixtureManifest } from './monorepo.fixture.types';
import { UnitChecker } from './unit-checker';
import type { UnitPlaces } from './unit-checker.types';
import { UnitMap } from './unit-map';
import type { Violation } from './violation';

// Мини-монорепо на изолированной установке Bun (D-108): единицы платформы
// (`platform/kernel`, `platform/domain`), реализации (`backend/alpha`),
// раннеров (`runners/assembly`, `runners/cli`); корень — не единица. Модули —
// `alpha` → `beta`. Вход графа — `scripts/app.graph.ts` → `@t/domain`.
// Фикстура пишется целиком до `install()` (кэш резолвера Bun), каждый тест — в
// своём каталоге. Нарушения: ARC-16 (а) по каталогу единицы, затем ARC-14/15
// по пути файла и импортам, затем ARC-16 (б) в порядке обхода.
let repo: Monorepo;

beforeEach(() => {
  repo = Monorepo.create();
});

afterEach(() => {
  repo.dispose();
});

const at = (path: string): string => join(repo.proj, path);

const KERNEL: FixtureManifest = {
  name: '@t/kernel',
  exports: { '.': './src/index.ts' },
};

/** Как каркас `monorepo` (`scaffold-layout.ts`): вход, контракт, testing, модуль. */
const DOMAIN: FixtureManifest = {
  name: '@t/domain',
  exports: {
    '.': './src/index.ts',
    './*/contract': './src/*/contract.ts',
    './*/testing': './src/*/testing.ts',
    './*': './src/*/index.ts',
  },
  dependencies: ['@t/kernel'],
};

const ALPHA: FixtureManifest = {
  name: '@t/be-alpha',
  exports: { '.': './src/index.ts' },
  dependencies: ['@t/domain'],
  devDependencies: ['ext-dev'],
  peerDependencies: ['ext-peer'],
};

const ASSEMBLY: FixtureManifest = {
  name: '@t/assembly',
  exports: { '.': './src/index.ts' },
  dependencies: ['@t/domain', '@t/kernel', '@t/be-alpha'],
};

/** Без `exports`, как `@<scope>/cli` каркаса: любой подпуть — поверхность. */
const CLI: FixtureManifest = {
  name: '@t/cli',
  dependencies: ['@t/domain', '@t/assembly', '@v/scoped'],
};

/**
 * Чистое дерево: vendor-пакеты, корень (`root-ext`, домен и реализация —
 * для входа графа), единицы и их файлы. Тест дописывает своё до `check`.
 */
function standard(kernel = 'platform/kernel'): void {
  for (const name of ['ext-a', 'ext-dev', 'ext-peer', 'root-ext']) {
    repo.vendor(name);
  }
  repo.vendor('@v/scoped', { 'index.ts': 'export {};\n', 'sub.ts': '' });
  const workspaces = [
    ...new Set([`${kernel.split('/')[0]}/*`, 'platform/*']),
    'backend/*',
    'runners/*',
  ];
  repo
    .root({
      workspaces,
      devDependencies: ['root-ext', '@t/domain', '@t/be-alpha'],
    })
    .unit(kernel, KERNEL)
    .unit('platform/domain', DOMAIN)
    .unit('backend/alpha', ALPHA)
    .unit('runners/assembly', ASSEMBLY)
    .unit('runners/cli', CLI)
    .write(`${kernel}/src/index.ts`)
    .write('platform/domain/src/index.ts', '@t/kernel')
    .write('platform/domain/src/alpha/contract.ts')
    .write('platform/domain/src/alpha/index.ts')
    .write('platform/domain/src/alpha/testing.ts')
    .write('platform/domain/src/alpha/alpha.state.ts')
    .write('platform/domain/src/alpha/alpha.fixture.ts')
    .write('backend/alpha/src/index.ts', '@t/domain/alpha')
    .write('runners/assembly/src/index.ts', '@t/be-alpha', '@t/domain')
    .write('runners/cli/src/main.ts', '@t/assembly')
    .write('scripts/app.graph.ts', '@t/domain');
}

type Places = LayerPlaces & UnitPlaces;

const places = (over: Partial<Places> = {}): Places => ({
  project: repo.proj,
  layout: {
    kernel: at('platform/kernel/src'),
    domain: at('platform/domain/src/{m}'),
    backend: at('backend/{m}/src'),
    assembly: at('runners/assembly/src'),
  },
  runners: [at('runners/cli/src')],
  entry: 'contract',
  graphEntry: at('scripts/app.graph.ts'),
  ...over,
});

/** Проверка без установки: проект как есть. */
const checkAsIs = (
  over: Partial<Places> = {},
  providers: readonly GraphProvider[] = [],
  roots: readonly AnyModuleDef[] = [AlphaModuleDef],
): string[] => {
  const app = places(over);
  const map = new LayerMap(DefIndex.from(roots), app, providers);
  return new UnitChecker(map, UnitMap.read(repo.proj), app)
    .check()
    .map((v: Violation) => v.format());
};

/** Установка, затем проверка: после неё фикстура не меняется. */
const check = (
  over: Partial<Places> = {},
  providers: readonly GraphProvider[] = [],
  roots: readonly AnyModuleDef[] = [AlphaModuleDef],
): string[] => {
  repo.install();
  return checkAsIs(over, providers, roots);
};

/** Сообщение отказа сборки проверок (в конструкторе или в `check`). */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'не бросил';
}

const undeclared = (unit: string, pkg: string): string =>
  `(${unit}) импортирует ${pkg} — нет в package.json единицы`;

const PAST_EXPORTS =
  'импортирует @t/domain мимо exports (или пакет не установлен — bun install)';

describe('UnitChecker: ARC-14 — пакет объявляет всё, что импортирует', () => {
  it('ARC-14: рабочий код импортирует необъявленный внешний пакет — import, export … from, import()', () => {
    standard();
    repo.file(
      'backend/alpha/src/note.ts',
      [
        "import { a } from 'ext-a';",
        "export { b } from 'ext-a/sub';",
        "export const lazy = () => import('ext-a/lazy');",
        '',
      ].join('\n'),
    );
    expect(check()).toEqual([
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', 'ext-a')}: ext-a`,
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', 'ext-a')}: ext-a/sub`,
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', 'ext-a')}: ext-a/lazy`,
    ]);
  });

  it('ARC-14: необъявленный пакет, который разрешается через корень, — по спецификатору, не по разрешению', () => {
    standard();
    repo.write('backend/alpha/src/note.ts', 'root-ext');
    expect(check()).toEqual([
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', 'root-ext')}: root-ext`,
    ]);
  });

  it('ARC-14: необъявленная единица — только ARC-14, без ARC-15 (в изолированной установке не разрешается)', () => {
    standard();
    repo.write('backend/alpha/src/note.ts', '@t/kernel');
    expect(check()).toEqual([
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', '@t/kernel')}: @t/kernel`,
    ]);
  });

  it('ARC-14: необъявленный import type', () => {
    standard();
    repo.file(
      'backend/alpha/src/note.ts',
      "import type { A } from 'ext-a';\nexport type B = A;\n",
    );
    expect(check()).toEqual([
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', 'ext-a')}: ext-a`,
    ]);
  });

  it('ARC-14: пакет из devDependencies в рабочем коде', () => {
    standard();
    repo.write('backend/alpha/src/note.ts', 'ext-dev');
    expect(check()).toEqual([
      'ARC-14: backend/alpha/src/note.ts (@t/be-alpha) импортирует ext-dev из devDependencies в рабочем коде: ext-dev',
    ]);
  });

  it('ARC-14: devDependencies в тестовом коде — .test.ts, .fixture.ts, каталог tests/, testing.ts — можно', () => {
    standard();
    repo
      .write('backend/alpha/src/note.test.ts', 'ext-dev')
      .write('backend/alpha/src/note.fixture.ts', 'ext-dev')
      .write('backend/alpha/tests/helper.ts', 'ext-dev')
      .write('backend/alpha/src/testing.ts', 'ext-dev');
    expect(check()).toEqual([]);
  });

  it('ARC-14: peerDependencies в рабочем коде — можно', () => {
    standard();
    repo.write('backend/alpha/src/note.ts', 'ext-peer');
    expect(check()).toEqual([]);
  });

  it('ARC-14: файл реализации внешнего модуля (D-37) внутри единицы — проверяется, как любой файл единицы', () => {
    standard();
    repo
      .unit('backend/beta', { name: '@t/be-beta' })
      .write('backend/beta/src/legacy.ts', 'ext-a');
    const beta = ModuleDef.define({ ...BetaModuleDef, external: true });
    const roots = [ModuleDef.define({ ...AlphaModuleDef, dependsOn: [beta] })];
    expect(check({}, [], roots)).toEqual([
      `ARC-14: backend/beta/src/legacy.ts ${undeclared('@t/be-beta', 'ext-a')}: ext-a`,
    ]);
  });

  it('ARC-14: подпуть scoped-пакета при объявленном пакете — можно', () => {
    standard();
    repo.write('runners/cli/src/view.ts', '@v/scoped/sub');
    expect(check()).toEqual([]);
  });

  it('ARC-14: подпуть необъявленного scoped-пакета — нарушение с именем пакета без подпути', () => {
    standard();
    repo.write('backend/alpha/src/note.ts', '@v/scoped/sub');
    expect(check()).toEqual([
      `ARC-14: backend/alpha/src/note.ts ${undeclared('@t/be-alpha', '@v/scoped')}: @v/scoped/sub`,
    ]);
  });
});

describe('UnitChecker: ARC-15 — между пакетами только имя и exports', () => {
  it('ARC-15: рабочий код уходит относительным путём в другую единицу', () => {
    standard();
    repo.write(
      'backend/alpha/src/note.ts',
      '../../../platform/kernel/src/index',
    );
    expect(check()).toEqual([
      'ARC-15: backend/alpha/src/note.ts (@t/be-alpha) импортирует за границу пакета относительным путём: ../../../platform/kernel/src/index',
    ]);
  });

  it('ARC-15: тестовый код уходит относительным путём в общую папку вне единиц — помощник теста не через /testing', () => {
    standard();
    repo
      .write('test-utils/helpers.ts')
      .write('backend/alpha/src/note.test.ts', '../../../test-utils/helpers');
    expect(check()).toEqual([
      'ARC-15: backend/alpha/src/note.test.ts (@t/be-alpha) импортирует за границу пакета относительным путём: ../../../test-utils/helpers',
    ]);
  });

  it('ARC-15: объявленная единица мимо exports', () => {
    standard();
    repo.write('backend/alpha/src/note.ts', '@t/domain/src/alpha/alpha.state');
    expect(check()).toEqual([
      `ARC-15: backend/alpha/src/note.ts (@t/be-alpha) ${PAST_EXPORTS}: @t/domain/src/alpha/alpha.state`,
    ]);
  });

  it('ARC-14, ARC-15: единица только из devDependencies в рабочем коде и мимо exports — оба нарушения', () => {
    standard();
    repo
      .unit('runners/cli', {
        ...CLI,
        dependencies: ['@t/assembly', '@v/scoped'],
        devDependencies: ['@t/domain'],
      })
      .write('runners/cli/src/view.ts', '@t/domain/src/alpha/alpha.state');
    expect(check()).toEqual([
      'ARC-14: runners/cli/src/view.ts (@t/cli) импортирует @t/domain из devDependencies в рабочем коде: @t/domain/src/alpha/alpha.state',
      `ARC-15: runners/cli/src/view.ts (@t/cli) ${PAST_EXPORTS}: @t/domain/src/alpha/alpha.state`,
    ]);
  });

  it('ARC-15: объявленный внешний пакет не разрешается — не единица, ARC-15 нет', () => {
    standard();
    repo
      .unit('backend/alpha', {
        ...ALPHA,
        dependencies: ['@t/domain', 'ext-a'],
      })
      .write('backend/alpha/src/note.ts', 'ext-a/нет');
    expect(check()).toEqual([]);
  });

  it('ARC-15: помощник теста мимо /testing — глубокий путь к фикстуре домена', () => {
    standard();
    repo.write(
      'backend/alpha/src/note.test.ts',
      '@t/domain/src/alpha/alpha.fixture',
    );
    expect(check()).toEqual([
      `ARC-15: backend/alpha/src/note.test.ts (@t/be-alpha) ${PAST_EXPORTS}: @t/domain/src/alpha/alpha.fixture`,
    ]);
  });

  it('ARC-15: помощник теста через вход /testing из exports — можно', () => {
    standard();
    repo.write('backend/alpha/src/note.test.ts', '@t/domain/alpha/testing');
    expect(check()).toEqual([]);
  });

  it('ARC-15: входы из exports — корень, шаблоны ./*/contract и ./* — можно', () => {
    standard();
    repo.write(
      'backend/alpha/src/note.ts',
      '@t/domain',
      '@t/domain/alpha/contract',
      '@t/domain/alpha',
    );
    expect(check()).toEqual([]);
  });
});

describe('UnitChecker: ARC-16 (а) — платформа не объявляет реализаций и раннеров', () => {
  it('ARC-16: package.json домена объявляет реализацию в dependencies и раннер в devDependencies', () => {
    standard();
    repo.unit('platform/domain', {
      ...DOMAIN,
      dependencies: ['@t/kernel', '@t/be-alpha'],
      devDependencies: ['@t/cli'],
    });
    expect(check()).toEqual([
      'ARC-16: platform/domain/package.json (@t/domain) объявляет @t/be-alpha — реализацию',
      'ARC-16: platform/domain/package.json (@t/domain) объявляет @t/cli — раннер',
    ]);
  });

  it('ARC-16: единица платформы — по оси слоя, не по каталогу: kernel в core/kernel объявляет реализацию', () => {
    standard('core/kernel');
    repo.unit('core/kernel', { ...KERNEL, peerDependencies: ['@t/be-alpha'] });
    const layout = { ...places().layout, kernel: at('core/kernel/src') };
    expect(check({ layout })).toEqual([
      'ARC-16: core/kernel/package.json (@t/kernel) объявляет @t/be-alpha — реализацию',
    ]);
  });

  it('ARC-16: единица в platform/ без слоёв объявляет реализацию — можно', () => {
    standard();
    repo
      .unit('platform/tools', {
        name: '@t/tools',
        dependencies: ['@t/be-alpha'],
      })
      .write('platform/tools/src/index.ts', '@t/be-alpha');
    expect(check()).toEqual([]);
  });

  it('ARC-16: единица со слоем поставщика на оси платформы объявляет раннер', () => {
    standard();
    repo
      .unit('platform/ui', { name: '@t/ui', dependencies: ['@t/cli'] })
      .write('platform/ui/src/widget.ts');
    const widgets: SourceLayer = {
      name: 'widgets',
      axis: 'platform',
      rule: 'TOY-03',
      sees: [{ layer: 'kernel' }],
    };
    expect(
      check({ layers: { widgets: [at('platform/ui/src')] } }, [
        new LayerProvider('toy', [widgets]),
      ]),
    ).toEqual([
      'ARC-16: platform/ui/package.json (@t/ui) объявляет @t/cli — раннер',
    ]);
  });
});

describe('UnitChecker: ARC-16 (б) — замыкание входа графа без реализаций', () => {
  const REACHES =
    'ARC-16: вход графа scripts/app.graph.ts доходит до реализации';

  it('ARC-16: вход графа через файл вне слоёв и единиц доходит до реализации', () => {
    standard();
    repo
      .write('scripts/app.graph.ts', '@t/domain', './helper')
      .write('scripts/helper.ts', '@t/be-alpha');
    expect(check()).toEqual([
      `${REACHES}: scripts/helper.ts импортирует backend alpha: @t/be-alpha`,
    ]);
  });

  it('ARC-16: вход графа доходит до реализации только через import type', () => {
    standard();
    repo.file(
      'scripts/app.graph.ts',
      [
        "import { v0 } from '@t/domain';",
        "import type { Alpha } from '@t/be-alpha';",
        'export {};',
        '',
      ].join('\n'),
    );
    expect(check()).toEqual([
      `${REACHES}: scripts/app.graph.ts импортирует backend alpha: @t/be-alpha`,
    ]);
  });

  it('ARC-16: раннеры проходятся — вход → раннер → сборка → реализация', () => {
    standard();
    repo.write('scripts/app.graph.ts', '@t/domain', '../runners/cli/src/main');
    expect(check()).toEqual([
      `${REACHES}: runners/assembly/src/index.ts импортирует backend alpha: @t/be-alpha`,
    ]);
  });

  it('ARC-16: вход графа доходит до слоя поставщика на оси раннеров — можно', () => {
    standard();
    repo
      .write('scripts/app.graph.ts', '@t/domain', '../ui/views/screen')
      .write('ui/views/screen.ts', '../../platform/kernel/src/index');
    const views: SourceLayer = {
      name: 'views',
      axis: 'runner',
      rule: 'TOY-02',
      sees: [{ layer: 'kernel' }],
    };
    expect(
      check({ layers: { views: [at('ui/views')] } }, [
        new LayerProvider('toy', [views]),
      ]),
    ).toEqual([]);
  });

  it('ARC-16: цикл импортов, цель в node_modules и вне project — без зацикливания и нарушений', () => {
    standard();
    repo
      .write(
        'scripts/app.graph.ts',
        '@t/domain',
        './cycle-a',
        'root-ext',
        '../../vendor/ext-a/index',
      )
      .write('scripts/cycle-a.ts', './cycle-b')
      .write('scripts/cycle-b.ts', './cycle-a', './app.graph');
    expect(check()).toEqual([]);
  });
});

describe('UnitChecker: без нарушений', () => {
  it('ARC-14: встроенные модули рантайма — node:fs, fs, fs/promises, bun, bun:test', () => {
    standard();
    repo.write(
      'backend/alpha/src/note.ts',
      'node:fs',
      'fs',
      'fs/promises',
      'bun',
      'bun:test',
    );
    expect(check()).toEqual([]);
  });

  it('ARC-14: #imports — поле imports в package.json своей единицы', () => {
    standard();
    repo
      .unit('backend/alpha', {
        ...ALPHA,
        imports: { '#internal': './src/internal.ts' },
      })
      .write('backend/alpha/src/internal.ts')
      .write('backend/alpha/src/note.ts', '#internal');
    expect(check()).toEqual([]);
  });

  it('ARC-14, ARC-15: собственное имя единицы — @t/domain изнутри домена', () => {
    standard();
    repo.write(
      'platform/domain/src/alpha/note.ts',
      '@t/domain',
      '@t/domain/alpha/contract',
    );
    expect(check()).toEqual([]);
  });

  it('ARC-15: относительный путь внутри своей единицы — из tests/ в src/', () => {
    standard();
    repo.write('backend/alpha/tests/helper.ts', '../src/index');
    expect(check()).toEqual([]);
  });

  it('ARC-14, ARC-15: файл корня вне единиц (scripts/) импортирует необъявленное и уходит относительным путём в единицу — нет ARC-14/15', () => {
    standard();
    repo.write('scripts/tool.ts', 'ext-a', '../backend/alpha/src/index');
    expect(check()).toEqual([]);
  });
});

describe('UnitChecker: порядок нарушений', () => {
  it('ARC-14…16: ARC-16 (а) по каталогу единицы, затем ARC-14/15 по пути файла, затем ARC-16 (б)', () => {
    standard();
    repo
      .unit('platform/kernel', { ...KERNEL, dependencies: ['@t/cli'] })
      .unit('platform/domain', {
        ...DOMAIN,
        dependencies: ['@t/kernel', '@t/be-alpha'],
      })
      .write('backend/alpha/src/b.ts', 'ext-a')
      .write('backend/alpha/src/a.ts', '../../../platform/kernel/src/index')
      .write('scripts/app.graph.ts', '@t/domain', './helper')
      .write('scripts/helper.ts', '@t/be-alpha');
    expect(check()).toEqual([
      'ARC-16: platform/domain/package.json (@t/domain) объявляет @t/be-alpha — реализацию',
      'ARC-16: platform/kernel/package.json (@t/kernel) объявляет @t/cli — раннер',
      'ARC-15: backend/alpha/src/a.ts (@t/be-alpha) импортирует за границу пакета относительным путём: ../../../platform/kernel/src/index',
      `ARC-14: backend/alpha/src/b.ts ${undeclared('@t/be-alpha', 'ext-a')}: ext-a`,
      'ARC-16: вход графа scripts/app.graph.ts доходит до реализации: scripts/helper.ts импортирует backend alpha: @t/be-alpha',
    ]);
  });
});

describe('UnitChecker: single — единиц нет, ARC-14…16 молчат', () => {
  it('ARC-14…16: те же нарушения в проекте без workspaces', () => {
    repo
      .root({ name: 'single' })
      .unit('platform/domain', { ...DOMAIN, dependencies: ['@t/be-alpha'] })
      .unit('backend/alpha', ALPHA)
      .write('backend/alpha/src/note.ts', 'ext-a', '../../../platform/x')
      .write('scripts/app.graph.ts', '../backend/alpha/src/index');
    expect(check()).toEqual([]);
  });

  it('ARC-14…16: проект без package.json, вход графа не проверяется', () => {
    repo
      .unit('backend/alpha', ALPHA)
      .write('backend/alpha/src/note.ts', 'ext-a', '../../../platform/x');
    expect(checkAsIs({ graphEntry: at('scripts/нет.graph.ts') })).toEqual([]);
  });
});

describe('UnitChecker: отказ', () => {
  it('ARC-16: вход графа вне project — отказ', () => {
    standard();
    const outside = join(repo.base, 'vendor', 'ext-a', 'index.ts');
    expect(refusal(() => check({ graphEntry: outside }))).toBe(
      `ArchApp.graphEntry — файл вне ArchApp.project: ${outside}`,
    );
  });

  it('ARC-16: файла входа графа нет — отказ', () => {
    standard();
    const missing = at('scripts/missing.graph.ts');
    expect(refusal(() => check({ graphEntry: missing }))).toBe(
      `ArchApp.graphEntry — нет файла: ${missing}`,
    );
  });
});
