import { describe, expect, it } from 'bun:test';
import { AppDef } from '../domain/contracts/app-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import { ExampleArch } from '../testing/example/example.arch';
import { TodoModuleDef } from '../testing/example/platform/domain/todo';
import { UsersModuleDef } from '../testing/example/platform/domain/users';
import { RuleProvider, StubRule, toyRuleProvider } from './arch.fixture';
import { ArchChecker } from './arch-checker';

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
const nowhere = () => ({ domain: '/нет/домена', backend: '/нет/пакета' });

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

  it('с раскладкой — проверки по Def, затем по файлам', () => {
    const checker = new ArchChecker(DefIndex.from([broken]), nowhere);
    expect(checker.check().map((v) => v.format())).toEqual([
      'MAN-01: модуль broken: пустой label',
      'ARC-06: модуль broken: нет /нет/домена/broken.module.ts',
      'ARC-06: модуль broken: нет /нет/пакета/broken.module.ts',
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
    const empty = {
      def: AppDef.define({
        name: 'empty',
        label: 'Пустое',
        description: 'Приложение без модулей.',
        modules: [],
      }),
      layout: ExampleArch.layout,
    };
    expect(ArchChecker.of(empty).check()).toEqual([]);
  });

  it('вход модуля для других — из приложения (`entry`, по умолчанию index)', () => {
    // Пример входит через `contract.ts`; при входе `index` тот же импорт —
    // нарушение ARC-04 в домене и прикладном слое, ARC-07 в корне сборки и
    // ARC-08 в раннере: `ExampleArch` охватывает их, и `users` — тоже
    // (через `dependsOn` todo).
    const app = { ...ExampleArch, entry: undefined };
    const arc04 = (file: string) =>
      `ARC-04: ${file} импортирует users мимо index.ts: #core/testing/example/platform/domain/users/contract`;
    const root = (file: string, m: string) =>
      `ARC-07: корень сборки assembly/${file} импортирует ${m} мимо index.ts: #core/testing/example/platform/domain/${m}/contract`;
    expect(
      ArchChecker.of(app)
        .check()
        .map((v) => v.format()),
    ).toEqual([
      // домен
      arc04('todo/task/er/release-removed-user-tasks.er.ts'),
      arc04('todo/task/task.rules.ts'),
      arc04('todo/task/uc/assign-task.uc.test.ts'),
      arc04('todo/task/uc/assign-task.uc.ts'),
      arc04('todo/todo.module.ts'),
      // прикладной слой (`backend/`)
      arc04('todo/task/er/release-removed-user-tasks.er.test.ts'),
      arc04('todo/task/uc/assign-task.uc.test.ts'),
      arc04('todo/task/uc/assign-task.uc.ts'),
      arc04('todo/todo.module.test.ts'),
      // корень сборки (`runners/assembly/`, ARC-07)
      root('example-app.test.ts', 'todo'),
      root('example-app.test.ts', 'users'),
      root('example-app.ts', 'todo'),
      root('example-app.ts', 'users'),
      root('example-caller-resolver.ts', 'users'),
      root('example-delegation.test.ts', 'users'),
      // раннер (ARC-08)
      'ARC-08: раннер cli/example-cli.ts импортирует todo мимо index.ts: #core/testing/example/platform/domain/todo/contract',
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
