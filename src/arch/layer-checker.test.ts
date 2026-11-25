import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { type AnyModuleDef, ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import type { GraphProvider } from '../graph/graph-provider';
import type { SourceLayer } from '../graph/source-layer.types';
import { ExampleAppDef } from '../testing/example/platform/domain/example.app';
import { ScreenDef } from '../testing/example/screen/screen-def';
import { ScreenProvider } from '../testing/example/screen/screen-provider';
import { TasksScreenDef } from '../testing/example/screen/tasks.screen';
import { AlphaModuleDef, BetaModuleDef, LayerProvider } from './arch.fixture';
import { FRAMEWORK_LAYERS } from './framework-layers';
import { LayerChecker } from './layer-checker';
import type { FrameworkDirs, LayerPlaces } from './layer-checker.types';
import { LayerMap } from './layer-map';

// Временный проект `<base>/proj`; `<base>/outside` — каталог вне проекта.
// Модули — `alpha` → `beta` (замыкание `dependsOn`), вход модуля — `contract`.
// Нарушения — по алфавиту пути файла от `project`, в файле — в порядке
// импортов; у одного импорта вход — раньше `dependsOn`.
let base: string;
let root: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'arch-layers-')));
  root = join(base, 'proj');
  mkdirSync(root);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const dirs = (): FrameworkDirs => ({
  kernel: join(root, 'kernel'),
  domain: join(root, 'domain', '{m}'),
  backend: join(root, 'backend', '{m}'),
  assembly: join(root, 'runners', 'assembly'),
});

const places = (over: Partial<LayerPlaces> = {}): LayerPlaces => ({
  project: root,
  layout: dirs(),
  runners: [join(root, 'runners', 'cli')],
  entry: 'contract',
  ...over,
});

const check = (
  over: Partial<LayerPlaces> = {},
  providers: readonly GraphProvider[] = [],
  roots: readonly AnyModuleDef[] = [AlphaModuleDef],
): string[] => {
  // Отказы мест слоёв (`refusal`) бросает конструктор `LayerMap`, не `LayerChecker`.
  const at = places(over);
  const map = new LayerMap(DefIndex.from(roots), at, providers);
  return new LayerChecker(map, at).check().map((v) => v.format());
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

/** Файл проекта: по импорту на спецификатор, в порядке аргументов. */
function write(path: string, ...specs: readonly string[]): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  const lines = specs.map((spec, i) => `import { v${i} } from '${spec}';`);
  writeFileSync(file, [...lines, 'export {};', ''].join('\n'));
}

/**
 * Чистое дерево по таблице spec, без `backend/app`: домен → kernel и
 * `beta/contract`; реализация → свой `index` и `contract`, kernel; сборка →
 * `backend/<m>` (`index`), `domain/<m>/contract`, kernel; раннер → сборка,
 * kernel, `contract`.
 */
function cleanTree(): void {
  write('kernel/fields.ts', './ids', 'node:path');
  write('kernel/ids.ts');
  for (const m of ['alpha', 'beta']) {
    write(`domain/${m}/contract.ts`);
    write(`domain/${m}/index.ts`);
    write(`backend/${m}/index.ts`);
    write(`backend/${m}/${m}.module.ts`);
  }
  write('domain/alpha/note/note.events.ts');
  write(
    'domain/alpha/note/note.ar.ts',
    '../../../kernel/fields',
    '../../beta/contract',
  );
  write('domain/beta/item/item.events.ts');
  write('domain/beta/item/item.ar.ts', '../../../kernel/fields');
  write(
    'backend/alpha/note/er/add-note.er.ts',
    '../../../../domain/alpha',
    '../../../../domain/alpha/contract',
    '../../../../kernel/fields',
  );
  write(
    'backend/beta/item/uc/create-item.uc.ts',
    '../../../../domain/beta/index',
    '../../../../kernel/ids',
  );
  write(
    'runners/assembly/app.ts',
    '../../backend/alpha',
    '../../backend/beta/index',
    '../../domain/beta/contract',
    '../../kernel/fields',
    'node:path',
  );
  write(
    'runners/cli/main.ts',
    '../assembly/app',
    '../../kernel/fields',
    '../../domain/alpha/contract',
    'node:path',
  );
}

/** Слой поставщика `toy`: ось раннеров, правило TOY-02, видит kernel. */
const views = (over: Partial<SourceLayer> = {}): SourceLayer => ({
  name: 'views',
  axis: 'runner',
  rule: 'TOY-02',
  sees: [{ layer: 'kernel' }],
  ...over,
});

/** Слой `pages` поставщика `toy` по его модулям `home` и `cart` (D-110). */
const pages = (over: Partial<SourceLayer> = {}): SourceLayer =>
  views({ name: 'pages', perModule: ['home', 'cart'], ...over });

/** Каталоги слоёв по модулям — `<root>/<слой>/{m}`, по ключу на слой. */
const modularDirs = (
  ...layers: readonly SourceLayer[]
): Record<string, string[]> =>
  Object.fromEntries(layers.map((l) => [l.name, [join(root, l.name, '{m}')]]));

const externals = (alpha: boolean, beta: boolean): AnyModuleDef[] => {
  const dep = ModuleDef.define({ ...BetaModuleDef, external: beta });
  return [
    ModuleDef.define({ ...AlphaModuleDef, external: alpha, dependsOn: [dep] }),
  ];
};

const bareModule = (
  name: string,
  dependsOn: readonly AnyModuleDef[] = [],
): AnyModuleDef =>
  ModuleDef.define({
    name,
    label: 'Модуль',
    description: 'Модуль без Def внутри — для проверки слоёв.',
    dependsOn: [...dependsOn],
    aggregates: [],
    useCases: [],
    reactions: [],
    jobs: [],
  });

describe('FRAMEWORK_LAYERS', () => {
  it('шесть слоёв фреймворка: имя, ось, ID, по модулям, вход testing', () => {
    expect(
      FRAMEWORK_LAYERS.map((l) =>
        [
          l.name,
          l.axis,
          l.rule,
          l.perModule === true ? 'perModule' : '',
          l.testEntry === true ? 'testEntry' : '',
        ]
          .filter((part) => part !== '')
          .join(' '),
      ),
    ).toEqual([
      'kernel platform ARC-02',
      'domain platform ARC-02 perModule testEntry',
      'backend-app implementation ARC-06',
      'backend implementation ARC-06 perModule',
      'assembly runner ARC-07',
      'runner runner ARC-08',
    ]);
  });
});

describe('LayerChecker: таблица видимости', () => {
  it('чистое дерево без backend/app — без нарушений', () => {
    cleanTree();
    expect(check()).toEqual([]);
  });

  describe('kernel', () => {
    it('разрешено: свои файлы и встроенные модули', () => {
      cleanTree();
      write('kernel/errors/error-def.ts', '../ids', '../fields');
      write('kernel/fields.ts', './ids', './errors/error-def', 'node:path');
      expect(check()).toEqual([]);
    });

    it('запрещено: домен, реализация, сборка, раннер относительным путём — ARC-02', () => {
      cleanTree();
      write(
        'kernel/fields.ts',
        '../domain/alpha/contract',
        '../domain/fixture.app',
        '../backend/alpha/index',
        '../runners/assembly/app',
        '../runners/cli/main',
      );
      expect(check()).toEqual([
        'ARC-02: kernel/fields.ts (kernel) импортирует domain alpha: ../domain/alpha/contract',
        'ARC-02: kernel/fields.ts (kernel) импортирует domain: ../domain/fixture.app',
        'ARC-02: kernel/fields.ts (kernel) импортирует backend alpha: ../backend/alpha/index',
        'ARC-02: kernel/fields.ts (kernel) импортирует assembly: ../runners/assembly/app',
        'ARC-02: kernel/fields.ts (kernel) импортирует runner: ../runners/cli/main',
      ]);
    });
  });

  describe('домен', () => {
    it('разрешено: kernel, beta/contract (в dependsOn), свой модуль глубоко', () => {
      cleanTree();
      write(
        'domain/alpha/note/note.ar.ts',
        '../../../kernel/fields',
        '../../beta/contract',
        './note.events',
        '../index',
      );
      expect(check()).toEqual([]);
    });

    it('запрещено: реализация, сборка, раннер — ARC-02', () => {
      cleanTree();
      write(
        'domain/alpha/note/note.ar.ts',
        '../../../backend/alpha',
        '../../../runners/assembly/app',
        '../../../runners/cli/main',
      );
      expect(check()).toEqual([
        'ARC-02: domain/alpha/note/note.ar.ts (domain) импортирует backend alpha: ../../../backend/alpha',
        'ARC-02: domain/alpha/note/note.ar.ts (domain) импортирует assembly: ../../../runners/assembly/app',
        'ARC-02: domain/alpha/note/note.ar.ts (domain) импортирует runner: ../../../runners/cli/main',
      ]);
    });

    it('запрещено: чужой модуль мимо contract.ts — ARC-04', () => {
      cleanTree();
      write('domain/alpha/note/note.ar.ts', '../../beta/item/item.ar');
      expect(check()).toEqual([
        'ARC-04: domain/alpha/note/note.ar.ts (domain) импортирует domain beta мимо contract.ts: ../../beta/item/item.ar',
      ]);
    });

    it('запрещено: beta → alpha, которого нет в dependsOn — ARC-04', () => {
      cleanTree();
      write('domain/beta/item/item.ar.ts', '../../alpha/contract');
      expect(check()).toEqual([
        'ARC-04: domain/beta/item/item.ar.ts (domain) импортирует alpha, которого нет в dependsOn beta',
      ]);
    });
  });

  describe('backend/app — общее реализаций', () => {
    it('разрешено: реализация и сборка → backend/app; backend/app → kernel и contract', () => {
      cleanTree();
      write(
        'backend/app/shared.ts',
        '../../kernel/fields',
        '../../domain/alpha/contract',
      );
      write(
        'backend/alpha/note/er/add-note.er.ts',
        '../../../app/shared',
        '../../../../domain/alpha/contract',
      );
      write('runners/assembly/app.ts', '../../backend/app/shared');
      expect(check()).toEqual([]);
    });

    it('запрещено: backend/app → реализация модуля, сборка, раннер — ARC-06', () => {
      cleanTree();
      write(
        'backend/app/shared.ts',
        '../alpha/index',
        '../../runners/assembly/app',
        '../../runners/cli/main',
      );
      expect(check()).toEqual([
        'ARC-06: backend/app/shared.ts (backend-app) импортирует backend alpha: ../alpha/index',
        'ARC-06: backend/app/shared.ts (backend-app) импортирует assembly: ../../runners/assembly/app',
        'ARC-06: backend/app/shared.ts (backend-app) импортирует runner: ../../runners/cli/main',
      ]);
    });

    it('запрещено: домен и kernel → backend/app — ARC-02, раннер → backend/app — ARC-08', () => {
      cleanTree();
      write('backend/app/shared.ts');
      write('domain/alpha/note/note.ar.ts', '../../../backend/app/shared');
      write('kernel/fields.ts', '../backend/app/shared');
      write('runners/cli/main.ts', '../../backend/app/shared');
      expect(check()).toEqual([
        'ARC-02: domain/alpha/note/note.ar.ts (domain) импортирует backend-app: ../../../backend/app/shared',
        'ARC-02: kernel/fields.ts (kernel) импортирует backend-app: ../backend/app/shared',
        'ARC-08: runners/cli/main.ts (runner) импортирует backend-app: ../../backend/app/shared',
      ]);
    });
  });

  describe('реализация', () => {
    it('разрешено: kernel, backend/app, свой index и contract, beta/contract, свой модуль', () => {
      cleanTree();
      write('backend/app/shared.ts');
      write(
        'backend/alpha/note/er/add-note.er.ts',
        '../../../../kernel/fields',
        '../../../app/shared',
        '../../../../domain/alpha',
        '../../../../domain/alpha/index',
        '../../../../domain/alpha/contract',
        '../../../../domain/beta/contract',
        '../../alpha.module',
      );
      expect(check()).toEqual([]);
    });

    it('запрещено: чужая реализация, сборка, раннер — ARC-06', () => {
      cleanTree();
      write(
        'backend/alpha/note/er/add-note.er.ts',
        '../../../beta/index',
        '../../../../runners/assembly/app',
        '../../../../runners/cli/main',
      );
      expect(check()).toEqual([
        'ARC-06: backend/alpha/note/er/add-note.er.ts (backend) импортирует backend beta: ../../../beta/index',
        'ARC-06: backend/alpha/note/er/add-note.er.ts (backend) импортирует assembly: ../../../../runners/assembly/app',
        'ARC-06: backend/alpha/note/er/add-note.er.ts (backend) импортирует runner: ../../../../runners/cli/main',
      ]);
    });

    it('запрещено: свой домен глубоко — ARC-04 мимо index.ts и contract.ts (D-107)', () => {
      cleanTree();
      write(
        'backend/alpha/note/er/add-note.er.ts',
        '../../../../domain/alpha/note/note.ar',
      );
      expect(check()).toEqual([
        'ARC-04: backend/alpha/note/er/add-note.er.ts (backend) импортирует domain alpha мимо index.ts и contract.ts: ../../../../domain/alpha/note/note.ar',
      ]);
    });

    it('запрещено: чужой домен глубоко и модуль вне dependsOn — ARC-04', () => {
      cleanTree();
      write(
        'backend/alpha/note/er/add-note.er.ts',
        '../../../../domain/beta/item/item.ar',
      );
      write(
        'backend/beta/item/uc/create-item.uc.ts',
        '../../../../domain/alpha/contract',
      );
      expect(check()).toEqual([
        'ARC-04: backend/alpha/note/er/add-note.er.ts (backend) импортирует domain beta мимо contract.ts: ../../../../domain/beta/item/item.ar',
        'ARC-04: backend/beta/item/uc/create-item.uc.ts (backend) импортирует alpha, которого нет в dependsOn beta',
      ]);
    });
  });

  describe('сборка', () => {
    it('разрешено: backend/<m> через index, contract, kernel, backend/app', () => {
      cleanTree();
      write('backend/app/shared.ts');
      write(
        'runners/assembly/app.ts',
        '../../backend/alpha',
        '../../backend/beta/index',
        '../../domain/alpha/contract',
        '../../kernel/ids',
        '../../backend/app/shared',
      );
      expect(check()).toEqual([]);
    });

    it('запрещено: реализация мимо index.ts — ARC-07', () => {
      cleanTree();
      write(
        'runners/assembly/app.ts',
        '../../backend/beta/item/uc/create-item.uc',
      );
      expect(check()).toEqual([
        'ARC-07: runners/assembly/app.ts (assembly) импортирует backend beta мимо index.ts: ../../backend/beta/item/uc/create-item.uc',
      ]);
    });

    it('запрещено: домен мимо contract.ts — ARC-07', () => {
      cleanTree();
      write('runners/assembly/app.ts', '../../domain/beta');
      expect(check()).toEqual([
        'ARC-07: runners/assembly/app.ts (assembly) импортирует domain beta мимо contract.ts: ../../domain/beta',
      ]);
    });

    it('запрещено: раннер — ARC-07', () => {
      cleanTree();
      write('runners/assembly/app.ts', '../cli/main');
      expect(check()).toEqual([
        'ARC-07: runners/assembly/app.ts (assembly) импортирует runner: ../cli/main',
      ]);
    });
  });

  describe('раннер-процесс', () => {
    it('разрешено: сборка, kernel, contract', () => {
      cleanTree();
      write('runners/assembly/wiring.ts');
      write(
        'runners/cli/main.ts',
        '../assembly/wiring',
        '../../kernel/ids',
        '../../domain/beta/contract',
      );
      expect(check()).toEqual([]);
    });

    it('запрещено: реализация и даже её index — ARC-08', () => {
      cleanTree();
      write(
        'runners/cli/main.ts',
        '../../backend/beta',
        '../../backend/beta/index',
        '../../backend/beta/item/uc/create-item.uc',
      );
      expect(check()).toEqual([
        'ARC-08: runners/cli/main.ts (runner) импортирует backend beta: ../../backend/beta',
        'ARC-08: runners/cli/main.ts (runner) импортирует backend beta: ../../backend/beta/index',
        'ARC-08: runners/cli/main.ts (runner) импортирует backend beta: ../../backend/beta/item/uc/create-item.uc',
      ]);
    });

    it('запрещено: домен мимо contract.ts — ARC-08', () => {
      cleanTree();
      write('runners/cli/main.ts', '../../domain/beta/item/item.events');
      expect(check()).toEqual([
        'ARC-08: runners/cli/main.ts (runner) импортирует domain beta мимо contract.ts: ../../domain/beta/item/item.events',
      ]);
    });
  });
});

describe('LayerChecker: вход testing (TST-07, D-70)', () => {
  const testingTree = (): void => {
    cleanTree();
    write('domain/beta/testing.ts');
  };

  it('тестовый код домена, реализации, сборки и раннера импортирует beta/testing', () => {
    testingTree();
    write('domain/alpha/note/note.ar.test.ts', '../../beta/testing');
    write('domain/alpha/testing.ts', '../beta/testing');
    write(
      'backend/alpha/note/er/add-note.fixture.ts',
      '../../../../domain/beta/testing',
    );
    write(
      'backend/alpha/note/er/add-note.test-kit.ts',
      '../../../../domain/beta/testing',
    );
    write(
      'backend/alpha/note/note.repo.fake.ts',
      '../../../domain/beta/testing',
    );
    write('backend/alpha/tests/notes.ts', '../../../domain/beta/testing');
    write('runners/assembly/app.test.ts', '../../domain/beta/testing');
    write('runners/cli/main.test.ts', '../../domain/beta/testing');
    expect(check()).toEqual([]);
  });

  it('рабочий код этих слоёв импортирует beta/testing — TST-07', () => {
    testingTree();
    write(
      'backend/alpha/note/job/purge-notes.job.ts',
      '../../../../domain/beta/testing',
    );
    write('domain/alpha/note/er/add-note.er.ts', '../../../beta/testing');
    write('runners/assembly/wiring.ts', '../../domain/beta/testing');
    write('runners/cli/main.ts', '../../domain/beta/testing');
    expect(check()).toEqual([
      'TST-07: backend/alpha/note/job/purge-notes.job.ts (backend) импортирует testing.ts модуля beta — вход только для тестового кода: ../../../../domain/beta/testing',
      'TST-07: domain/alpha/note/er/add-note.er.ts (domain) импортирует testing.ts модуля beta — вход только для тестового кода: ../../../beta/testing',
      'TST-07: runners/assembly/wiring.ts (assembly) импортирует testing.ts модуля beta — вход только для тестового кода: ../../domain/beta/testing',
      'TST-07: runners/cli/main.ts (runner) импортирует testing.ts модуля beta — вход только для тестового кода: ../../domain/beta/testing',
    ]);
  });

  it('тестовый код мимо contract и testing — ARC-04 или ID слоя, как рабочий', () => {
    testingTree();
    write('domain/alpha/note/note.ar.test.ts', '../../beta/item/item.ar');
    write('runners/cli/main.test.ts', '../../domain/beta/item/item.ar');
    expect(check()).toEqual([
      'ARC-04: domain/alpha/note/note.ar.test.ts (domain) импортирует domain beta мимо contract.ts: ../../beta/item/item.ar',
      'ARC-08: runners/cli/main.test.ts (runner) импортирует domain beta мимо contract.ts: ../../domain/beta/item/item.ar',
    ]);
  });

  it('ArchApp.testing: fixtures — testing.ts уже не вход, fixtures.ts — вход тестового кода', () => {
    testingTree();
    write('domain/beta/fixtures.ts');
    write(
      'domain/alpha/note/note.ar.test.ts',
      '../../beta/fixtures',
      '../../beta/testing',
    );
    write('domain/alpha/note/er/add-note.er.ts', '../../../beta/fixtures');
    expect(check({ testing: 'fixtures' })).toEqual([
      'TST-07: domain/alpha/note/er/add-note.er.ts (domain) импортирует fixtures.ts модуля beta — вход только для тестового кода: ../../../beta/fixtures',
      'ARC-04: domain/alpha/note/note.ar.test.ts (domain) импортирует domain beta мимо contract.ts: ../../beta/testing',
    ]);
  });
});

describe('LayerChecker: вход модуля из ArchApp.entry', () => {
  const entryTree = (): void => {
    write('domain/alpha/note/note.ar.ts', '../../beta/contract');
    write('domain/alpha/note/note.ts', '../../beta/index', '../../beta');
  };

  it('entry: contract — contract.ts вход, index — мимо', () => {
    entryTree();
    expect(check()).toEqual([
      'ARC-04: domain/alpha/note/note.ts (domain) импортирует domain beta мимо contract.ts: ../../beta/index',
      'ARC-04: domain/alpha/note/note.ts (domain) импортирует domain beta мимо contract.ts: ../../beta',
    ]);
  });

  it('без entry — вход index (и сам каталог), contract.ts — мимо', () => {
    entryTree();
    expect(check({ entry: undefined })).toEqual([
      'ARC-04: domain/alpha/note/note.ar.ts (domain) импортирует domain beta мимо index.ts: ../../beta/contract',
    ]);
  });

  it('без entry вход своего модуля из реализации один — index.ts', () => {
    write(
      'backend/alpha/note/er/add-note.er.ts',
      '../../../../domain/alpha',
      '../../../../domain/alpha/note/note.ar',
    );
    expect(check({ entry: undefined })).toEqual([
      'ARC-04: backend/alpha/note/er/add-note.er.ts (backend) импортирует domain alpha мимо index.ts: ../../../../domain/alpha/note/note.ar',
    ]);
  });
});

describe('LayerChecker: внешний модуль (D-37)', () => {
  const deepImport = (): void => {
    cleanTree();
    write('domain/alpha/note/note.ar.ts', '../../beta/item/item.ar');
  };
  const violation =
    'ARC-04: domain/alpha/note/note.ar.ts (domain) импортирует domain beta мимо contract.ts: ../../beta/item/item.ar';

  it('external → external: вход не проверяется', () => {
    deepImport();
    expect(check({}, [], externals(true, true))).toEqual([]);
  });

  it('external → модуль на Def: ARC-04', () => {
    deepImport();
    expect(check({}, [], externals(true, false))).toEqual([violation]);
  });

  it('модуль на Def → external: ARC-04', () => {
    deepImport();
    expect(check({}, [], externals(false, true))).toEqual([violation]);
  });

  it('dependsOn проверяется и между внешними — ARC-04', () => {
    cleanTree();
    write('domain/beta/item/item.ar.ts', '../../alpha/note/note.ar');
    expect(check({}, [], externals(true, true))).toEqual([
      'ARC-04: domain/beta/item/item.ar.ts (domain) импортирует alpha, которого нет в dependsOn beta',
    ]);
  });

  it('файлы реализации внешнего модуля не сканируются', () => {
    cleanTree();
    write(
      'backend/beta/legacy/factory.ts',
      '../../../runners/assembly/app',
      '../../alpha/index',
      '../../../domain/alpha/note/note.ar',
    );
    expect(check({}, [], externals(false, true))).toEqual([]);
  });

  it('сборка → реализация внешнего модуля глубоко — без нарушений', () => {
    cleanTree();
    write('runners/assembly/app.ts', '../../backend/beta/legacy/factory');
    expect(check({}, [], externals(false, true))).toEqual([]);
  });

  it('сборка → домен внешнего модуля мимо входа — ARC-07', () => {
    cleanTree();
    write('runners/assembly/app.ts', '../../domain/beta/item/item.events');
    expect(check({}, [], externals(false, true))).toEqual([
      'ARC-07: runners/assembly/app.ts (assembly) импортирует domain beta мимо contract.ts: ../../domain/beta/item/item.events',
    ]);
  });

  it('раннер → реализация внешнего модуля — ARC-08', () => {
    cleanTree();
    write('runners/cli/main.ts', '../../backend/beta/legacy/factory');
    expect(check({}, [], externals(false, true))).toEqual([
      'ARC-08: runners/cli/main.ts (runner) импортирует backend beta: ../../backend/beta/legacy/factory',
    ]);
  });

  it('реализация → реализация внешнего модуля — ARC-06', () => {
    cleanTree();
    write(
      'backend/alpha/note/er/add-note.er.ts',
      '../../../beta/legacy/factory',
    );
    expect(check({}, [], externals(false, true))).toEqual([
      'ARC-06: backend/alpha/note/er/add-note.er.ts (backend) импортирует backend beta: ../../../beta/legacy/factory',
    ]);
  });
});

describe('LayerChecker: каталоги слоёв', () => {
  it('модуль из замыкания dependsOn (не корневой) проверяется', () => {
    cleanTree();
    write('runners/assembly/app.ts', '../../backend/beta/beta.module');
    expect(check({}, [], [AlphaModuleDef])).toEqual([
      'ARC-07: runners/assembly/app.ts (assembly) импортирует backend beta мимо index.ts: ../../backend/beta/beta.module',
    ]);
  });

  it('самый глубокий каталог: реализация внутри каталога сборки — слой backend', () => {
    write('app/alpha/index.ts');
    write('app/beta/item/uc/create-item.uc.ts', '../../../alpha/index');
    const layout = {
      ...dirs(),
      backend: join(root, 'app', '{m}'),
      assembly: join(root, 'app'),
    };
    expect(check({ layout })).toEqual([
      'ARC-06: app/beta/item/uc/create-item.uc.ts (backend) импортирует backend alpha: ../../../alpha/index',
    ]);
  });

  it('самый глубокий каталог: раннер внутри каталога сборки — слой runner', () => {
    cleanTree();
    write('runners/assembly/cli/main.ts', '../../../backend/beta');
    expect(
      check({ runners: [join(root, 'runners', 'assembly', 'cli')] }),
    ).toEqual([
      'ARC-08: runners/assembly/cli/main.ts (runner) импортирует backend beta: ../../../backend/beta',
    ]);
  });

  it('самый глубокий каталог: слой поставщика внутри раннера — слой поставщика', () => {
    cleanTree();
    write('runners/cli/views/page.ts', '../../assembly/app');
    const toy = new LayerProvider('toy', [views()]);
    expect(
      check({ layers: { views: [join(root, 'runners', 'cli', 'views')] } }, [
        toy,
      ]),
    ).toEqual([
      'TOY-02: runners/cli/views/page.ts (views) импортирует assembly: ../../assembly/app',
    ]);
  });

  it('модуль домена с именем kernel — слой домена, не kernel', () => {
    const kernel = bareModule('kernel', [BetaModuleDef]);
    write('domain/beta/contract.ts');
    write('domain/kernel/clock.ts', '../beta/contract', '../beta/item/item.ar');
    expect(check({}, [], [kernel])).toEqual([
      'ARC-04: domain/kernel/clock.ts (domain) импортирует domain beta мимо contract.ts: ../beta/item/item.ar',
    ]);
  });

  it('модуль app в индексе — отказ: каталог совпадает с backend/app', () => {
    expect(
      refusal(() => check({}, [], [bareModule('app'), AlphaModuleDef])),
    ).toBe(
      'модуль app: каталог реализации совпадает с общим реализаций backend/app — имя зарезервировано (D-106)',
    );
  });

  it('раннер в каталоге сборки — отказ: два слоя с одним каталогом', () => {
    expect(
      refusal(() => check({ runners: [join(root, 'runners', 'assembly')] })),
    ).toBe('ArchApp: у слоёв assembly и runner один каталог runners/assembly');
  });

  it('каталог слоя вне ArchApp.project — отказ', () => {
    const outside = join(base, 'outside');
    expect(refusal(() => check({ runners: [outside] }))).toBe(
      `каталог слоя runner вне ArchApp.project: ${outside}`,
    );
  });

  it('ArchApp.project не существует — отказ, а не пустой обход', () => {
    rmSync(root, { recursive: true });
    expect(refusal(() => check())).toBe(
      `ArchApp.project — нет каталога: ${root}`,
    );
  });

  it('шаблон слоя по модулям без {m} — отказ', () => {
    const layout = { ...dirs(), domain: join(root, 'domain') };
    expect(refusal(() => check({ layout }))).toBe(
      'ArchApp.layout.domain — шаблон с {m}',
    );
  });
});

describe('LayerChecker: корень домена — слой домена без модуля', () => {
  it('<имя>.app.ts → alpha/contract, сборка → domain/<имя>.app — без нарушений', () => {
    cleanTree();
    write('domain/fixture.app.ts', './alpha/contract', './beta/contract');
    write('runners/assembly/app.ts', '../../domain/fixture.app');
    expect(check()).toEqual([]);
  });

  it('<имя>.app.ts → alpha глубоко — ARC-04, → реализация — ARC-02', () => {
    cleanTree();
    write('domain/fixture.app.ts', './alpha/note/note.ar', '../backend/alpha');
    expect(check()).toEqual([
      'ARC-04: domain/fixture.app.ts (domain) импортирует domain alpha мимо contract.ts: ./alpha/note/note.ar',
      'ARC-02: domain/fixture.app.ts (domain) импортирует backend alpha: ../backend/alpha',
    ]);
  });

  it('модуль → корень домена — ARC-04 (D-112), корень → модуль — без нарушения', () => {
    cleanTree();
    write('domain/fixture.app.ts', './alpha/contract', './beta/contract');
    write('domain/beta/note/note.ar.ts', '../../fixture.app');
    expect(check()).toEqual([
      'ARC-04: domain/beta/note/note.ar.ts (domain) импортирует корень слоя domain — соседние модули видны только через их contract.ts и по dependsOn: ../../fixture.app',
    ]);
  });
});

describe('LayerChecker: файл вне слоёв', () => {
  it('скрипт видит всё, кроме модуля домена мимо contract и testing из рабочего кода', () => {
    cleanTree();
    write('domain/beta/testing.ts');
    write('index.ts', './domain/alpha/contract', './runners/assembly/app');
    write(
      'scripts/x.ts',
      '../domain/alpha/note/note.ar',
      '../domain/beta/testing',
      '../domain/alpha/contract',
      '../backend/alpha/note/er/add-note.er',
      '../runners/assembly/app',
    );
    write('scripts/x.test.ts', '../domain/beta/testing');
    expect(check()).toEqual([
      'ARC-04: scripts/x.ts (вне слоёв) импортирует domain alpha мимо contract.ts: ../domain/alpha/note/note.ar',
      'TST-07: scripts/x.ts (вне слоёв) импортирует testing.ts модуля beta — вход только для тестового кода: ../domain/beta/testing',
    ]);
  });

  it('реализация → файл вне слоёв — ARC-06', () => {
    cleanTree();
    write('scripts/x.ts');
    write('backend/alpha/note/er/add-note.er.ts', '../../../../scripts/x');
    expect(check()).toEqual([
      'ARC-06: backend/alpha/note/er/add-note.er.ts (backend) импортирует файл вне слоёв: ../../../../scripts/x',
    ]);
  });
});

describe('LayerChecker: пакеты', () => {
  it('пакет workspaces проверяется по разрешённому каталогу: раннер → @acme/be-alpha — ARC-08', () => {
    cleanTree();
    writeFileSync(
      join(root, 'backend', 'alpha', 'package.json'),
      JSON.stringify({
        name: '@acme/be-alpha',
        exports: { '.': './index.ts' },
      }),
    );
    mkdirSync(join(root, 'node_modules', '@acme'), { recursive: true });
    symlinkSync(
      join(root, 'backend', 'alpha'),
      join(root, 'node_modules', '@acme', 'be-alpha'),
    );
    write('runners/cli/main.ts', '@acme/be-alpha');
    expect(check()).toEqual([
      'ARC-08: runners/cli/main.ts (runner) импортирует backend alpha: @acme/be-alpha',
    ]);
  });

  it('настоящий пакет в node_modules — пропуск; файлы node_modules не сканируются', () => {
    cleanTree();
    write('node_modules/left-pad/index.ts', '../../domain/alpha/note/note.ar');
    writeFileSync(
      join(root, 'node_modules', 'left-pad', 'package.json'),
      JSON.stringify({ name: 'left-pad', main: 'index.ts' }),
    );
    write(
      'backend/alpha/node_modules/dep/index.ts',
      '../../../../domain/beta/item/item.ar',
    );
    write('runners/cli/main.ts', 'left-pad');
    expect(check()).toEqual([]);
  });

  it('цель вне project — пропуск', () => {
    cleanTree();
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'lib.ts'), 'export {};\n');
    write('kernel/fields.ts', '../../outside/lib');
    write('runners/cli/main.ts', '../../../outside/lib');
    expect(check()).toEqual([]);
  });
});

describe('LayerChecker: путь проекта', () => {
  // Каталоги слоёв сверяются с разрешённым project: без нормализации обход и
  // «цель в проекте» шли бы по сырой строке и молча не находили нарушений.
  const violations = [
    'ARC-02: kernel/fields.ts (kernel) импортирует backend alpha: ../backend/alpha/index',
    'ARC-08: runners/cli/main.ts (runner) импортирует backend beta: ../../backend/beta',
  ];
  const tree = (): void => {
    cleanTree();
    write('kernel/fields.ts', '../backend/alpha/index');
    write('runners/cli/main.ts', '../../backend/beta');
  };

  it('project с / на конце — те же нарушения, что у абсолютного', () => {
    tree();
    expect(check()).toEqual(violations);
    expect(check({ project: `${root}/` })).toEqual(violations);
  });

  it('относительный project — те же нарушения, что у абсолютного', () => {
    tree();
    expect(check({ project: relative(process.cwd(), root) })).toEqual(
      violations,
    );
  });
});

describe('LayerChecker: место нарушения', () => {
  it('два раннера с одним basename различаются путём от project', () => {
    cleanTree();
    for (const r of ['a', 'b']) {
      write(`runners/${r}/src/main.ts`, '../../../backend/beta');
    }
    expect(
      check({
        runners: [
          join(root, 'runners', 'a', 'src'),
          join(root, 'runners', 'b', 'src'),
        ],
      }),
    ).toEqual([
      'ARC-08: runners/a/src/main.ts (runner) импортирует backend beta: ../../../backend/beta',
      'ARC-08: runners/b/src/main.ts (runner) импортирует backend beta: ../../../backend/beta',
    ]);
  });
});

describe('LayerChecker: слои поставщиков', () => {
  it('раннер → реализация — ARC-08 и screen → реализация — SCR-02 одним LayerChecker', () => {
    cleanTree();
    write('runners/cli/main.ts', '../../backend/alpha');
    write('screen/page.ts', '../backend/alpha');
    const screen = new ScreenProvider(ExampleAppDef, []);
    const layers = {
      screen: [join(root, 'screen')],
      'screen-code': [join(root, 'screen-code', '{m}')],
    };
    expect(check({ layers }, [screen])).toEqual([
      'ARC-08: runners/cli/main.ts (runner) импортирует backend alpha: ../../backend/alpha',
      'SCR-02: screen/page.ts (screen) импортирует backend alpha: ../backend/alpha',
    ]);
  });

  it('объявленный слой без записи в ArchApp.layers — ARC-13', () => {
    cleanTree();
    expect(check({}, [new LayerProvider('toy', [views()])])).toEqual([
      'ARC-13: слой views поставщика toy без каталога в ArchApp.layers',
    ]);
  });

  it('пустой список каталогов слоя — как без каталога, ARC-13', () => {
    cleanTree();
    expect(
      check({ layers: { views: [] } }, [new LayerProvider('toy', [views()])]),
    ).toEqual([
      'ARC-13: слой views поставщика toy без каталога в ArchApp.layers',
    ]);
  });

  it('доступ к домену без entries: любой файл модуля, но testing — только тестовому коду (TST-07)', () => {
    cleanTree();
    write('domain/beta/testing.ts');
    write(
      'views/page.ts',
      '../domain/beta/item/item.ar',
      '../domain/beta/testing',
    );
    write('views/page.test.ts', '../domain/beta/testing');
    const toy = new LayerProvider('toy', [
      views({ sees: [{ layer: 'kernel' }, { layer: 'domain' }] }),
    ]);
    expect(check({ layers: { views: [join(root, 'views')] } }, [toy])).toEqual([
      'TST-07: views/page.ts (views) импортирует testing.ts модуля beta — вход только для тестового кода: ../domain/beta/testing',
    ]);
  });

  it('слой по модулям: каталог на модуль из шаблона {m}, чужой модуль того же слоя — ID слоя', () => {
    cleanTree();
    write('pages/alpha/home.ts', './list', '../beta/item');
    write('pages/alpha/list.ts');
    write('pages/beta/item.ts');
    const toy = new LayerProvider('toy', [
      views({ name: 'pages', perModule: true }),
    ]);
    expect(
      check({ layers: { pages: [join(root, 'pages', '{m}')] } }, [toy]),
    ).toEqual([
      'TOY-02: pages/alpha/home.ts (pages) импортирует pages beta: ../beta/item',
    ]);
  });

  it('ключ ArchApp.layers без объявленного слоя — ARC-13', () => {
    cleanTree();
    expect(check({ layers: { ghost: [join(root, 'ghost')] } })).toEqual([
      'ARC-13: ArchApp.layers.ghost — слой не объявлен поставщиками графа',
    ]);
  });

  it('seenBy runner: раннер → слой поставщика можно, сборка → он же — ARC-07', () => {
    cleanTree();
    write('views/page.ts');
    write('runners/cli/main.ts', '../../views/page');
    write('runners/assembly/app.ts', '../../views/page');
    const toy = new LayerProvider('toy', [
      views({ seenBy: [{ layer: 'runner' }] }),
    ]);
    expect(check({ layers: { views: [join(root, 'views')] } }, [toy])).toEqual([
      'ARC-07: runners/assembly/app.ts (assembly) импортирует views: ../../views/page',
    ]);
  });

  it('sees с entries к слою не по модулям — вход в каталоге слоя', () => {
    cleanTree();
    write('runners/assembly/index.ts');
    write(
      'views/page.ts',
      '../runners/assembly',
      '../runners/assembly/index',
      '../runners/assembly/app',
    );
    const toy = new LayerProvider('toy', [
      views({ sees: [{ layer: 'assembly', entries: ['index'] }] }),
    ]);
    expect(check({ layers: { views: [join(root, 'views')] } }, [toy])).toEqual([
      'TOY-02: views/page.ts (views) импортирует assembly мимо index.ts: ../runners/assembly/app',
    ]);
  });

  it('sees к слою другого поставщика — можно; обратно без записи — ID слоя-импортёра', () => {
    cleanTree();
    write('views/page.ts', '../pages/home');
    write('pages/home.ts', '../views/page');
    const toy = new LayerProvider('toy', [
      views({ sees: [{ layer: 'pages' }] }),
    ]);
    const rival = new LayerProvider('rival', [
      { name: 'pages', axis: 'runner', rule: 'RIV-02', sees: [] },
    ]);
    const layers = {
      views: [join(root, 'views')],
      pages: [join(root, 'pages')],
    };
    expect(check({ layers }, [toy, rival])).toEqual([
      'RIV-02: pages/home.ts (pages) импортирует views: ../views/page',
    ]);
  });

  describe('отказ сборки проверок (ARC-13)', () => {
    const refuse = (...providers: readonly GraphProvider[]): string =>
      refusal(() =>
        check(
          {
            layers: {
              views: [join(root, 'views')],
              pages: [join(root, 'pages')],
            },
          },
          providers,
        ),
      );

    it('имя слоя занято слоем фреймворка', () => {
      const toy = new LayerProvider('toy', [views({ name: 'domain' })]);
      expect(refuse(toy)).toBe(
        'ARC-13: слой domain поставщика toy — имя занято слоем dmg-core',
      );
    });

    it('слой объявлен поставщиком дважды', () => {
      const toy = new LayerProvider('toy', [views(), views()]);
      expect(refuse(toy)).toBe(
        'ARC-13: слой views поставщика toy объявлен дважды',
      );
    });

    it('{m} в каталоге слоя не по модулям', () => {
      const toy = new LayerProvider('toy', [views()]);
      expect(
        refusal(() =>
          check({ layers: { views: [join(root, 'views', '{m}')] } }, [toy]),
        ),
      ).toBe('ArchApp.layers.views — {m} только у слоя по модулям');
    });

    it('один слой у двух поставщиков', () => {
      const toy = new LayerProvider('toy', [views()]);
      const rival = new LayerProvider('rival', [views({ rule: 'RIV-02' })]);
      expect(refuse(toy, rival)).toBe(
        'ARC-13: слой views у двух поставщиков — toy и rival',
      );
    });

    it('sees к backend', () => {
      const toy = new LayerProvider('toy', [
        views({ sees: [{ layer: 'backend' }] }),
      ]);
      expect(refuse(toy)).toBe(
        'ARC-13: слой views поставщика toy — sees к backend: слои реализаций поставщику недоступны',
      );
    });

    it('seenBy к backend-app', () => {
      const toy = new LayerProvider('toy', [
        views({ seenBy: [{ layer: 'backend-app' }] }),
      ]);
      expect(refuse(toy)).toBe(
        'ARC-13: слой views поставщика toy — seenBy к backend-app: слои реализаций поставщику недоступны',
      );
    });

    it('seenBy к слою другого поставщика', () => {
      const toy = new LayerProvider('toy', [
        views({ seenBy: [{ layer: 'pages' }] }),
      ]);
      const rival = new LayerProvider('rival', [
        { name: 'pages', axis: 'runner', rule: 'RIV-02', sees: [] },
      ]);
      expect(refuse(toy, rival)).toBe(
        'ARC-13: слой views поставщика toy — seenBy к pages: только к слоям dmg-core',
      );
    });

    it('sees к неизвестному слою', () => {
      const toy = new LayerProvider('toy', [
        views({ sees: [{ layer: 'ghost' }] }),
      ]);
      expect(refuse(toy)).toBe(
        'ARC-13: слой views поставщика toy — sees к неизвестному слою ghost',
      );
    });

    /** Отказ для слоёв поставщика `toy` по модулям: каталоги — шаблоны с {m}. */
    const refuseModular = (...layers: readonly SourceLayer[]): string =>
      refusal(() =>
        check({ layers: modularDirs(...layers) }, [
          new LayerProvider('toy', layers),
        ]),
      );

    it("others: 'dependsOn' к слою по модулям поставщика", () => {
      const byApp = pages({
        perModule: true,
        sees: [{ layer: 'logic', others: 'dependsOn' }],
      });
      expect(refuseModular(byApp, pages({ name: 'logic' }))).toBe(
        "ARC-13: слой pages поставщика toy — sees к logic с others: 'dependsOn': у модулей поставщика нет dependsOn",
      );
    });

    it("others: 'dependsOn' у слоя по модулям поставщика к домену", () => {
      const layer = pages({
        sees: [{ layer: 'domain', entries: ['public'], others: 'dependsOn' }],
      });
      expect(refuseModular(layer)).toBe(
        "ARC-13: слой pages поставщика toy — sees к domain с others: 'dependsOn': у модулей поставщика нет dependsOn",
      );
    });

    it('others к слою не по модулям', () => {
      expect([
        refuseModular(pages({ sees: [{ layer: 'kernel', others: 'none' }] })),
        refuse(
          new LayerProvider('toy', [
            views({
              sees: [
                { layer: 'domain', entries: ['public'], others: 'dependsOn' },
              ],
            }),
          ]),
        ),
        refuse(
          new LayerProvider('toy', [
            views({ seenBy: [{ layer: 'runner', others: 'none' }] }),
          ]),
        ),
      ]).toEqual([
        'ARC-13: слой pages поставщика toy — sees к kernel с others: оба слоя должны быть по модулям',
        'ARC-13: слой views поставщика toy — sees к domain с others: оба слоя должны быть по модулям',
        'ARC-13: слой views поставщика toy — seenBy к runner с others: оба слоя должны быть по модулям',
      ]);
    });

    it('имя модуля поставщика — не сегмент пути', () => {
      const names = ['', 'a/b', 'a\\b', '{m}', '.', '..'];
      expect(
        names.map((name) =>
          refuseModular(pages({ perModule: ['home', name] })),
        ),
      ).toEqual(
        names.map(
          (name) =>
            `ARC-13: слой pages поставщика toy — модуль «${name}» не имя каталога`,
        ),
      );
    });

    it('модуль поставщика дважды', () => {
      expect(
        refuseModular(pages({ perModule: ['home', 'cart', 'home'] })),
      ).toBe('ARC-13: слой pages поставщика toy — модуль home дважды');
    });

    it('entry слоя — не имя файла без расширения', () => {
      const entries = ['', 'public.ts', 'code/public', 'code\\public'];
      expect(entries.map((entry) => refuseModular(pages({ entry })))).toEqual(
        entries.map(
          (entry) =>
            `ARC-13: слой pages поставщика toy — entry «${entry}» не имя файла без расширения`,
        ),
      );
    });

    it("others: 'none' с entries — отказ", () => {
      const page = pages({
        sees: [{ layer: 'logic', others: 'none', entries: ['public'] }],
      });
      expect(refuseModular(page, pages({ name: 'logic' }))).toBe(
        "ARC-13: слой pages поставщика toy — sees к logic с others: 'none' и entries: чужой модуль закрыт, свой — через own или весь, entries не нужны",
      );
    });
  });
});

describe('LayerChecker: слой по модулям поставщика', () => {
  it('perModule списком: каталог на каждое имя поставщика, чужой модуль того же слоя — ID слоя', () => {
    cleanTree();
    write('pages/cart/item.ts', '../../runners/cli/main');
    write('pages/home/list.ts');
    write('pages/home/page.ts', './list', '../cart/item');
    const layer = pages();
    expect(
      check({ layers: modularDirs(layer) }, [
        new LayerProvider('toy', [layer]),
      ]),
    ).toEqual([
      'TOY-02: pages/cart/item.ts (pages) импортирует runner: ../../runners/cli/main',
      'TOY-02: pages/home/page.ts (pages) импортирует pages cart: ../cart/item',
    ]);
  });

  it('perModule списком: модуль AppDef не из списка каталога слоя не получает — файл вне слоёв', () => {
    cleanTree();
    write('pages/alpha/x.ts', '../../domain/beta/item/item.ar');
    write('pages/beta/x.ts', '../../domain/beta/item/item.ar');
    const layer = pages({ perModule: ['alpha'] });
    expect(
      check({ layers: modularDirs(layer) }, [
        new LayerProvider('toy', [layer]),
      ]),
    ).toEqual([
      'ARC-13: каталог pages/beta по шаблону слоя pages — beta не модуль слоя',
      'TOY-02: pages/alpha/x.ts (pages) импортирует domain beta: ../../domain/beta/item/item.ar',
      'ARC-04: pages/beta/x.ts (вне слоёв) импортирует domain beta мимо contract.ts: ../../domain/beta/item/item.ar',
    ]);
  });

  it('модуль поставщика с именем внешнего модуля AppDef — не внешний: файлы обходятся', () => {
    cleanTree();
    write('pages/alpha/page.ts', '../../runners/cli/main');
    const layer = pages({ axis: 'implementation', perModule: ['alpha'] });
    expect(
      check(
        { layers: modularDirs(layer) },
        [new LayerProvider('toy', [layer])],
        externals(true, false),
      ),
    ).toEqual([
      'TOY-02: pages/alpha/page.ts (pages) импортирует runner: ../../runners/cli/main',
    ]);
  });

  it("others: 'none' — свой модуль слоя-цели любой файл, чужой — «виден только свой модуль»", () => {
    cleanTree();
    write('logic/home/index.ts');
    write('logic/home/deep/calc.ts');
    write('logic/cart/public.ts');
    write('logic/cart/deep/calc.ts');
    write(
      'pages/home/page.ts',
      '../../logic/home/deep/calc',
      '../../logic/home',
      '../../logic/cart/public',
      '../../logic/cart/deep/calc',
    );
    const page = pages({
      sees: [
        { layer: 'kernel' },
        { layer: 'logic', others: 'none', rule: 'TOY-03' },
      ],
    });
    const logic = pages({ name: 'logic' });
    expect(
      check({ layers: modularDirs(page, logic) }, [
        new LayerProvider('toy', [page, logic]),
      ]),
    ).toEqual([
      'TOY-03: pages/home/page.ts (pages) импортирует logic cart — виден только свой модуль: ../../logic/cart/public',
      'TOY-03: pages/home/page.ts (pages) импортирует logic cart — виден только свой модуль: ../../logic/cart/deep/calc',
    ]);
  });

  it("others: 'none' с own — свой модуль только через own", () => {
    cleanTree();
    write('logic/home/public.ts');
    write('logic/home/deep/calc.ts');
    write(
      'pages/home/page.ts',
      '../../logic/home/public',
      '../../logic/home/deep/calc',
    );
    const page = pages({
      sees: [
        { layer: 'kernel' },
        { layer: 'logic', others: 'none', own: ['public'], rule: 'TOY-03' },
      ],
    });
    const logic = pages({ name: 'logic', entry: 'public' });
    expect(
      check({ layers: modularDirs(page, logic) }, [
        new LayerProvider('toy', [page, logic]),
      ]),
    ).toEqual([
      'TOY-03: pages/home/page.ts (pages) импортирует logic home мимо public.ts: ../../logic/home/deep/calc',
    ]);
  });

  it("others: 'none' — импорт из корня слоя без модуля в модуль слоя-цели — нарушение", () => {
    cleanTree();
    write('pages/home/page.ts');
    write('domain/example.app.ts', '../pages/home/page');
    const layer = pages({
      seenBy: [{ layer: 'domain', others: 'none', rule: 'TOY-03' }],
    });
    expect(
      check({ layers: modularDirs(layer) }, [
        new LayerProvider('toy', [layer]),
      ]),
    ).toEqual([
      'TOY-03: domain/example.app.ts (domain) импортирует pages home — виден только свой модуль: ../pages/home/page',
    ]);
  });

  it('чужой модуль того же слоя — ссылкой на себя через entry слоя, а не ArchApp.entry', () => {
    cleanTree();
    write('pages/b/public.ts');
    write('pages/b/contract.ts');
    write('pages/b/index.ts');
    write('pages/a/page.ts', './list', '../b/public', '../b/contract', '../b');
    write('pages/a/list.ts');
    const layer = pages({
      perModule: ['a', 'b'],
      entry: 'public',
      sees: [{ layer: 'kernel' }, { layer: 'pages', entries: ['public'] }],
    });
    expect(
      check({ layers: modularDirs(layer) }, [
        new LayerProvider('toy', [layer]),
      ]),
    ).toEqual([
      'TOY-02: pages/a/page.ts (pages) импортирует pages b мимо public.ts: ../b/contract',
      'TOY-02: pages/a/page.ts (pages) импортирует pages b мимо public.ts: ../b',
    ]);
  });

  it('образец screen: исполнение видит описание и чужой экран через public.ts, сборку — нет; описание не видит исполнение', () => {
    cleanTree();
    write('screen/screen-session.ts', '../screen-code/tasks/tasks-screen');
    write('screen-code/card/public.ts');
    write('screen-code/card/card-view.ts');
    write('screen-code/tasks/tasks-screen.types.ts');
    write(
      'screen-code/tasks/tasks-screen.ts',
      '../../screen/screen-session',
      '../../kernel/fields',
      '../../domain/alpha/contract',
      './tasks-screen.types',
      '../card/public',
      '../card/card-view',
      '../../runners/assembly/app',
    );
    const card = ScreenDef.define({
      name: 'card',
      label: 'Карточка',
      description: 'Карточка задачи — второй экран для проверки слоя.',
      visible: true,
      uses: [],
    });
    const screen = new ScreenProvider(ExampleAppDef, [TasksScreenDef, card]);
    const layers = {
      screen: [join(root, 'screen')],
      'screen-code': [join(root, 'screen-code', '{m}')],
    };
    expect(check({ layers }, [screen])).toEqual([
      'SCR-04: screen-code/tasks/tasks-screen.ts (screen-code) импортирует screen-code card мимо public.ts: ../card/card-view',
      'SCR-03: screen-code/tasks/tasks-screen.ts (screen-code) импортирует assembly: ../../runners/assembly/app',
      'SCR-02: screen/screen-session.ts (screen) импортирует screen-code tasks: ../screen-code/tasks/tasks-screen',
    ]);
  });

  it('образец screen: описание не видит сборку — SCR-02', () => {
    cleanTree();
    write(
      'screen/screen-session.ts',
      '../kernel/fields',
      '../domain/alpha/contract',
      '../runners/assembly/app',
    );
    const screen = new ScreenProvider(ExampleAppDef, [TasksScreenDef]);
    const layers = {
      screen: [join(root, 'screen')],
      'screen-code': [join(root, 'screen-code', '{m}')],
    };
    expect(check({ layers }, [screen])).toEqual([
      'SCR-02: screen/screen-session.ts (screen) импортирует assembly: ../runners/assembly/app',
    ]);
  });
});

describe('LayerMap: каталог по шаблону без модуля (ARC-13)', () => {
  it('каталог по шаблону слоя фреймворка без модуля — ARC-13; backend/app — не нарушение', () => {
    cleanTree();
    write('domain/ghost/x.ts');
    write('backend/ghost/x.ts');
    write('backend/app/x.ts');
    expect(check()).toEqual([
      'ARC-13: каталог domain/ghost по шаблону слоя domain — ghost не модуль слоя',
      'ARC-13: каталог backend/ghost по шаблону слоя backend — ghost не модуль слоя',
    ]);
  });

  it('каталог, где лежит каталог другого слоя, — не нарушение; лишний каталог общего корня — одна строка', () => {
    // `front/b` — не модуль chat, но в нём `front/b/logic`; `front/kit` — сам слой.
    cleanTree();
    write('front/a/logic/x.ts');
    write('front/b/logic/x.ts');
    write('front/a/chat/x.ts');
    write('front/kit/x.ts');
    write('front/ghost/x.ts');
    const logic = views({ name: 'logic', perModule: ['a', 'b'] });
    const chat = views({ name: 'chat', perModule: ['a'] });
    const kit = views({ name: 'kit' });
    const layers = {
      logic: [join(root, 'front', '{m}', 'logic')],
      chat: [join(root, 'front', '{m}', 'chat')],
      kit: [join(root, 'front', 'kit')],
    };
    expect(
      check({ layers }, [new LayerProvider('toy', [logic, chat, kit])]),
    ).toEqual([
      'ARC-13: каталог front/ghost по шаблону слоёв logic, chat — ghost не модуль этих слоёв',
    ]);
  });

  it('скрытый каталог и node_modules на месте {m} — не нарушение', () => {
    cleanTree();
    write('domain/.cache/x.ts');
    write('backend/node_modules/dep/index.ts');
    write('pages/.draft/x.ts');
    const layer = pages();
    expect(
      check({ layers: modularDirs(layer) }, [
        new LayerProvider('toy', [layer]),
      ]),
    ).toEqual([]);
  });
});
