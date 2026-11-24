import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AppDef } from '../domain/contracts/app-def';
import { type AnyModuleDef, ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import type { SourceLayer } from '../graph/source-layer.types';
import { ExampleArch } from '../testing/example/example.arch';
import { ExampleAppDef } from '../testing/example/platform/domain/example.app';
import { TodoModuleDef } from '../testing/example/platform/domain/todo';
import { ListTasksUcDef } from '../testing/example/platform/domain/todo/contract';
import { UsersModuleDef } from '../testing/example/platform/domain/users';
import { ScreenDef } from '../testing/example/screen/screen-def';
import { ScreenProvider } from '../testing/example/screen/screen-provider';
import { TasksScreenDef } from '../testing/example/screen/tasks.screen';
import {
  LayerProvider,
  RuleProvider,
  StubRule,
  toyRuleProvider,
} from './arch.fixture';
import { type ArchApp, ArchChecker } from './arch-checker';

const broken = ModuleDef.define({
  name: 'broken',
  label: '',
  description: 'Модуль без названия и без файлов.',
  dependsOn: [],
  aggregates: [],
  useCases: [],
  reactions: [],
  jobs: [],
});
/** Пустой проект: каталогов слоёв нет — проверять импорты нечего; вход графа пуст. */
const none = mkdtempSync(join(tmpdir(), 'arch-checker-'));
writeFileSync(join(none, 'broken.graph.ts'), '');
afterAll(() => rmSync(none, { recursive: true, force: true }));

/** Приложение с модулем `broken` в пустом проекте. */
const nowhere: ArchApp = {
  def: AppDef.define({
    name: 'broken',
    label: 'Сломанное',
    description: 'Приложение с модулем без названия.',
    modules: [broken],
  }),
  project: none,
  layout: {
    kernel: join(none, 'kernel'),
    domain: join(none, 'домена', '{m}'),
    backend: join(none, 'пакета', '{m}'),
    assembly: join(none, 'сборки'),
  },
  runners: [],
  graphEntry: join(none, 'broken.graph.ts'),
};

describe('ArchChecker', () => {
  it('без раскладки — только проверки по Def', () => {
    const checker = new ArchChecker(DefIndex.from([broken]));
    expect(checker.check().map((v) => v.format())).toEqual([
      'MAN-01: модуль broken: пустой label',
    ]);
  });

  it('defsOf(roots) — только Def по модулям; report() — строки нарушений', () => {
    expect(ArchChecker.defsOf([broken]).report()).toEqual([
      'MAN-01: модуль broken: пустой label',
    ]);
  });

  it('с приложением — проверки по Def, затем по файлам (каталоги из layout с {m})', () => {
    const checker = new ArchChecker(DefIndex.from([broken]), nowhere);
    expect(checker.check().map((v) => v.format())).toEqual([
      'MAN-01: модуль broken: пустой label',
      `ARC-06: модуль broken: нет ${none}/домена/broken/broken.module.ts`,
      `ARC-06: модуль broken: нет ${none}/пакета/broken/broken.module.ts`,
    ]);
  });

  it('todos() — незаполненные TODO в Def отдельно от check()', () => {
    const draft = ModuleDef.define({
      name: 'draft',
      label: 'TODO: название модуля',
      description: 'Заготовка модуля.',
      dependsOn: [],
      aggregates: [],
      useCases: [],
      reactions: [],
      jobs: [],
    });
    const checker = ArchChecker.defsOf([draft]);
    expect(checker.check()).toEqual([]);
    expect(checker.todos().map((v) => v.format())).toEqual([
      'MAN-01: модуль draft: label не заполнен — «TODO: название модуля»',
    ]);
  });

  it('учебный пример (todo + users) — без нарушений', () => {
    expect(ArchChecker.of(ExampleArch).check()).toEqual([]);
  });

  it('пустой домен — без нарушений', () => {
    // Каталоги без файлов: в дереве примера реализации todo и users при
    // пустом составе — вне слоёв, и сборка, импортирующая их, нарушала бы ARC-07.
    const empty: ArchApp = {
      ...nowhere,
      def: AppDef.define({
        name: 'empty',
        label: 'Пустое',
        description: 'Приложение без модулей.',
        modules: [],
      }),
    };
    expect(ArchChecker.of(empty).check()).toEqual([]);
  });

  it('вход модуля для других — из приложения (`entry`, по умолчанию index)', () => {
    // Пример входит через `contract.ts` и чист; без `entry` вход — `index`, и
    // те же импорты — нарушения мимо index.ts. Случаи по слоям — layer-checker.test.
    const lines = ArchChecker.of({ ...ExampleArch, entry: undefined }).report();
    expect(lines).not.toEqual([]);
    expect(
      lines.filter((line) => !/ мимо index\.ts: \S*\/contract$/.test(line)),
    ).toEqual([]);
  });

  it('проверки AppDef входят в of(): пустой label приложения — нарушение MAN-01', () => {
    const app = {
      ...ExampleArch,
      def: AppDef.define({
        name: 'example',
        label: '',
        description: 'Учебное приложение.',
        modules: [TodoModuleDef, UsersModuleDef],
      }),
    };
    expect(
      ArchChecker.of(app)
        .check()
        .map((v) => v.format()),
    ).toEqual(['MAN-01: приложение example: пустой label']);
  });

  it('состав приложения: модуль вне AppDef — нарушение MAN-15 в of()', () => {
    const app = {
      ...ExampleArch,
      def: AppDef.define({
        name: 'example',
        label: 'Пример',
        description: 'Учебное приложение.',
        modules: [TodoModuleDef],
      }),
    };
    expect(
      ArchChecker.of(app)
        .check()
        .map((v) => v.format()),
    ).toEqual([
      'MAN-15: приложение example: модуль users нужен модулю todo (dependsOn), но не входит в состав',
    ]);
  });

  it('todos() приложения — TODO в AppDef среди предупреждений of()', () => {
    const app = {
      ...ExampleArch,
      def: AppDef.define({
        name: 'example',
        label: 'TODO: название приложения',
        description: 'Учебное приложение.',
        modules: [TodoModuleDef, UsersModuleDef],
      }),
    };
    expect(
      ArchChecker.of(app)
        .todos()
        .map((v) => v.format()),
    ).toEqual([
      'MAN-01: приложение example: label не заполнен — «TODO: название приложения»',
    ]);
  });

  it('правило поставщика: нарушение TOY-01 — последняя строка report()', () => {
    const app = { ...ExampleArch, providers: [toyRuleProvider()] };
    expect(ArchChecker.of(app).report()).toEqual([
      'TOY-01: заметка example/toy без вложений',
    ]);
  });

  it('поставщики без правил: граф не строится, нарушений нет', () => {
    const plain = new RuleProvider('plain');
    const app = { ...ExampleArch, providers: [plain] };
    expect(ArchChecker.of(app).check()).toEqual([]);
    expect(plain.contributed).toBe(0);
  });

  it('неверный ID правила поставщика — отказ ARC-13 из of()', () => {
    const app = {
      ...ExampleArch,
      providers: [new RuleProvider('toy', [new StubRule('MAN-01')])],
    };
    expect(() => ArchChecker.of(app)).toThrow(
      'ARC-13: правило MAN-01 поставщика toy — префикс MAN занят правилами пакета dmg-core',
    );
  });
});

// Временный корень репо `<base>`: проект — `<base>/proj`, реестр долга кода —
// `<base>/debt.md`, Место записи — от корня репо. Вход графа — пустой
// `proj/app.graph.ts`.
let base: string;
let proj: string;

const freshRepo = (): void => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'arch-deviation-')));
  proj = join(base, 'proj');
  mkdirSync(proj);
  put('app.graph.ts');
};

const dropRepo = (): void => rmSync(base, { recursive: true, force: true });

/** Файл проекта: по импорту на спецификатор, в порядке аргументов. */
function put(path: string, ...specs: readonly string[]): void {
  const file = join(proj, path);
  mkdirSync(dirname(file), { recursive: true });
  const lines = specs.map((spec, i) => `import { v${i} } from '${spec}';`);
  writeFileSync(file, [...lines, 'export {};', ''].join('\n'));
}

/** Реестр `<base>/debt.md` с одной записью `DEBT-1`: Место и Правило. */
function registry(place: string, rule: string): void {
  writeFileSync(
    join(base, 'debt.md'),
    [
      '# Долг кода',
      '**Последний выданный ID:** `DEBT-1`',
      [
        '### DEBT-1: отступление от правила слоя',
        `- **Место:** \`${place}\``,
        `- **Правило:** \`${rule}\``,
        '- **Признак:** `импорт мимо входа`',
        '- **Корень:** `proj/**`',
        '- **Триггер:** вход для превью',
        '- **Причина:** нужно до входа.',
      ].join('\n'),
    ].join('\n\n'),
  );
}

/** Вход реестра: корень путей Места — `<base>`, префикс — `DEBT`. */
const debt = () => ({ root: base, code: 'debt.md', idPrefix: 'DEBT' });

/** Второй экран образца: вызывает UC, чтобы SCR-01 молчало. */
const CardScreenDef = ScreenDef.define({
  name: 'card',
  label: 'Карточка',
  description: 'Карточка задачи — второй экран для проверки отступления.',
  visible: true,
  uses: [ListTasksUcDef],
});

/** Проект без каталогов фреймворка: учебный домен, слои образца screen. */
const screenApp = (over: Partial<ArchApp> = {}): ArchApp => ({
  def: ExampleAppDef,
  providers: [
    new ScreenProvider(ExampleAppDef, [TasksScreenDef, CardScreenDef]),
  ],
  project: proj,
  runners: [],
  layers: {
    screen: [join(proj, 'screen')],
    'screen-code': [join(proj, 'screen-code', '{m}')],
  },
  graphEntry: join(proj, 'app.graph.ts'),
  ...over,
});

/** Модуль без Def-операций: только файлы модуля и импорты. */
const bare = (name: string): AnyModuleDef =>
  ModuleDef.define({
    name,
    label: `Модуль ${name}`,
    description: 'Модуль без Def внутри — для проверки слоёв.',
    dependsOn: [],
    aggregates: [],
    useCases: [],
    reactions: [],
    jobs: [],
  });

describe('ArchChecker: отступление через долг', () => {
  beforeEach(freshRepo);
  afterEach(dropRepo);

  it('образец screen: чужой экран мимо public.ts с записью Правило SCR-04 — без нарушений', () => {
    put('screen/screen-session.ts');
    put('screen-code/card/public.ts');
    put('screen-code/card/card-view.ts');
    put(
      'screen-code/tasks/tasks-screen.ts',
      '../../screen/screen-session',
      '../card/public',
      '../card/card-view',
    );
    registry('proj/screen-code/tasks/**', 'SCR-04');
    expect(ArchChecker.of(screenApp()).report()).toEqual([
      'SCR-04: screen-code/tasks/tasks-screen.ts (screen-code) импортирует screen-code card мимо public.ts: ../card/card-view',
    ]);
    expect(ArchChecker.of(screenApp({ debt: debt() })).report()).toEqual([]);
  });

  it('запись на ARC-06 не подавляет: ARC-06 остаётся, ARC-12 «отступления не допускает»', () => {
    for (const m of ['a', 'b']) {
      put(`domain/${m}/${m}.module.ts`);
      put(`backend/${m}/${m}.module.ts`);
    }
    put('backend/a/x.ts', '../b/b.module');
    registry('proj/backend/a/**', 'ARC-06');
    const app: ArchApp = {
      def: AppDef.define({
        name: 'pair',
        label: 'Пара',
        description: 'Два модуля без dependsOn друг на друга.',
        modules: [bare('a'), bare('b')],
      }),
      project: proj,
      layout: {
        kernel: join(proj, 'kernel'),
        domain: join(proj, 'domain', '{m}'),
        backend: join(proj, 'backend', '{m}'),
        assembly: join(proj, 'assembly'),
      },
      runners: [],
      graphEntry: join(proj, 'app.graph.ts'),
      debt: debt(),
    };
    expect(ArchChecker.of(app).report()).toEqual([
      'ARC-06: backend/a/x.ts (backend) импортирует backend b: ../b/b.module',
      'ARC-12: DEBT-1: правило ARC-06 отступления не допускает — нарушение остаётся',
    ]);
  });

  it("others: 'none' с debt и записью Правило — нарушение «виден только свой модуль» снято", () => {
    // Слои игрушечного поставщика по его модулям home и cart; pages видит logic
    // только своего модуля, доступ TOY-03 допускает отступление.
    const logic: SourceLayer = {
      name: 'logic',
      axis: 'runner',
      rule: 'TOY-02',
      perModule: ['home', 'cart'],
      sees: [],
    };
    const pages: SourceLayer = {
      ...logic,
      name: 'pages',
      sees: [{ layer: 'logic', others: 'none', rule: 'TOY-03', debt: true }],
    };
    put('logic/cart/public.ts');
    put('pages/home/page.ts', '../../logic/cart/public');
    registry('proj/pages/home/**', 'TOY-03');
    const app = (over: Partial<ArchApp> = {}): ArchApp => ({
      def: ExampleAppDef,
      providers: [new LayerProvider('toy', [logic, pages])],
      project: proj,
      runners: [],
      layers: {
        logic: [join(proj, 'logic', '{m}')],
        pages: [join(proj, 'pages', '{m}')],
      },
      graphEntry: join(proj, 'app.graph.ts'),
      ...over,
    });
    expect(ArchChecker.of(app()).report()).toEqual([
      'TOY-03: pages/home/page.ts (pages) импортирует logic cart — виден только свой модуль: ../../logic/cart/public',
    ]);
    expect(ArchChecker.of(app({ debt: debt() })).report()).toEqual([]);
  });
});

describe('ArchChecker: проект без layout', () => {
  beforeEach(freshRepo);
  afterEach(dropRepo);

  /** Домен — пакет `@acme/domain` в `node_modules`; его импортируют экран, раннер и вход графа. */
  const domainPackage = (): ArchApp => {
    const pkg = join(proj, 'node_modules', '@acme', 'domain');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@acme/domain', main: 'index.ts' }),
    );
    writeFileSync(join(pkg, 'index.ts'), 'export {};\n');
    put('runners/cli/main.ts', '@acme/domain');
    put('app.graph.ts', '@acme/domain');
    put('screen-code/tasks/tasks-screen.ts', '../../screen/screen-session');
    return screenApp({
      providers: [new ScreenProvider(ExampleAppDef, [TasksScreenDef])],
      runners: [join(proj, 'runners', 'cli')],
    });
  };

  it('домен пакетом: экран над пакетом домена — без нарушений, файлы модулей не проверяются', () => {
    const app = domainPackage();
    put('screen/screen-session.ts', '@acme/domain');
    expect(ArchChecker.of(app).report()).toEqual([]);
  });

  it('домен пакетом: слои поставщика проверяются — описание → исполнение SCR-02', () => {
    const app = domainPackage();
    put(
      'screen/screen-session.ts',
      '@acme/domain',
      '../screen-code/tasks/tasks-screen',
    );
    expect(ArchChecker.of(app).report()).toEqual([
      'SCR-02: screen/screen-session.ts (screen) импортирует screen-code tasks: ../screen-code/tasks/tasks-screen',
    ]);
  });
});
