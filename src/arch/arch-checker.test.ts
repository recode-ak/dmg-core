import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDef } from '../domain/contracts/app-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { DefIndex } from '../graph/def-index';
import { ExampleArch } from '../testing/example/example.arch';
import { TodoModuleDef } from '../testing/example/platform/domain/todo';
import { UsersModuleDef } from '../testing/example/platform/domain/users';
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
/** Пустой проект: каталогов слоёв нет — проверять импорты нечего. */
const none = mkdtempSync(join(tmpdir(), 'arch-checker-'));
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
