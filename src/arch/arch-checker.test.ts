import { describe, expect, it } from 'bun:test';
import { AppDef } from '../domain/contracts/app-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import { ExampleArch } from '../testing/example/example.arch';
import { ExampleAppDef } from '../testing/example/platform/domain/example.app';
import { TodoModuleDef } from '../testing/example/platform/domain/todo';
import { UsersModuleDef } from '../testing/example/platform/domain/users';
import { ScreenProvider } from '../testing/example/screen/screen-provider';
import { RuleProvider, StubRule, toyRuleProvider } from './arch.fixture';
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
/** Приложение с модулем `broken`; каталогов слоёв нет — проверять импорты нечего. */
const nowhere: ArchApp = {
  def: AppDef.define({
    name: 'broken',
    label: 'Сломанное',
    description: 'Приложение с модулем без названия.',
    modules: [broken],
  }),
  project: '/нет',
  layout: {
    kernel: '/нет/kernel',
    domain: '/нет/домена/{m}',
    backend: '/нет/пакета/{m}',
    assembly: '/нет/сборки',
  },
  runners: [],
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
      'ARC-06: модуль broken: нет /нет/домена/broken/broken.module.ts',
      'ARC-06: модуль broken: нет /нет/пакета/broken/broken.module.ts',
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
    // Пример входит через `contract.ts`; при входе `index` тот же импорт —
    // нарушение с ID слоя-импортёра: ARC-04 в домене (и в `<имя>.app.ts`
    // корня домена) и реализации, ARC-07 в сборке, ARC-08 в раннере, ARC-04
    // у файлов вне слоёв (`index.ts`, `screen/*`, `screen.test.ts`). `users`
    // проверяется через `dependsOn` todo.
    const app = { ...ExampleArch, entry: undefined };
    const users = (file: string, layer: string, rule = 'ARC-04') =>
      `${rule}: ${file} (${layer}) импортирует domain users мимо index.ts: #core/testing/example/platform/domain/users/contract`;
    const todo = (file: string, layer: string, rule: string) =>
      `${rule}: ${file} (${layer}) импортирует domain todo мимо index.ts: #core/testing/example/platform/domain/todo/contract`;
    const outside = (file: string, m: string, spec: string) =>
      `ARC-04: ${file} (вне слоёв) импортирует domain ${m} мимо index.ts: ${spec}`;
    const app04 = (m: string) =>
      `ARC-04: platform/domain/example.app.ts (domain) импортирует domain ${m} мимо index.ts: ./${m}/contract`;
    expect(
      ArchChecker.of(app)
        .check()
        .map((v) => v.format()),
    ).toEqual([
      // реализация (`backend/`)
      users(
        'backend/todo/task/er/release-removed-user-tasks.er.test.ts',
        'backend',
      ),
      users('backend/todo/task/uc/assign-task.uc.test.ts', 'backend'),
      users('backend/todo/task/uc/assign-task.uc.ts', 'backend'),
      users('backend/todo/todo.module.test.ts', 'backend'),
      // вход пакета `example` — вне слоёв
      outside('index.ts', 'todo', './platform/domain/todo/contract'),
      outside('index.ts', 'users', './platform/domain/users/contract'),
      // корень домена: AppDef
      app04('todo'),
      app04('users'),
      // домен
      users(
        'platform/domain/todo/task/er/release-removed-user-tasks.er.ts',
        'domain',
      ),
      users('platform/domain/todo/task/task.rules.ts', 'domain'),
      users('platform/domain/todo/task/uc/assign-task.uc.test.ts', 'domain'),
      users('platform/domain/todo/task/uc/assign-task.uc.ts', 'domain'),
      users('platform/domain/todo/todo.module.ts', 'domain'),
      // сборка (`runners/assembly/`)
      todo('runners/assembly/example-app.test.ts', 'assembly', 'ARC-07'),
      users('runners/assembly/example-app.test.ts', 'assembly', 'ARC-07'),
      todo('runners/assembly/example-app.ts', 'assembly', 'ARC-07'),
      users('runners/assembly/example-app.ts', 'assembly', 'ARC-07'),
      users(
        'runners/assembly/example-caller-resolver.ts',
        'assembly',
        'ARC-07',
      ),
      users(
        'runners/assembly/example-delegation.test.ts',
        'assembly',
        'ARC-07',
      ),
      // раннер (`runners/cli/`)
      todo('runners/cli/example-cli.ts', 'runner', 'ARC-08'),
      // образец «экран» — вне слоёв без ScreenArch
      outside('screen.test.ts', 'todo', './platform/domain/todo/contract'),
      outside(
        'screen/tasks-screen.ts',
        'todo',
        '../platform/domain/todo/contract',
      ),
      outside(
        'screen/tasks.screen.ts',
        'todo',
        '../platform/domain/todo/contract',
      ),
    ]);
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

  it('слой поставщика без каталога в ArchApp.layers — нарушение ARC-13 в of()', () => {
    const app = {
      ...ExampleArch,
      providers: [new ScreenProvider(ExampleAppDef, [])],
    };
    expect(ArchChecker.of(app).report()).toEqual([
      'ARC-13: слой screen поставщика example-screen без каталога в ArchApp.layers',
    ]);
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
