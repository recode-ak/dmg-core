import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDef } from '../domain/contracts/app-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { ExampleArch } from '../testing/example/example.arch';
import { RuleProvider, StubRule, toyRuleProvider } from './arch.fixture';
import type { ArchApp } from './arch-checker';
import { RULES_DOC, reportArchCheck } from './arch-report';

function run(apps: readonly ArchApp[], options?: { strict?: boolean }) {
  const lines: string[] = [];
  const code = reportArchCheck(apps, (line) => lines.push(line), options);
  return { code, lines };
}

/** Проект модуля-заготовки: только файлы модуля в домене и реализации. */
const root = mkdtempSync(join(tmpdir(), 'arch-report-'));
beforeAll(() => {
  for (const dir of ['domain', 'app']) {
    mkdirSync(join(root, dir, 'draft'), { recursive: true });
    writeFileSync(join(root, dir, 'draft', 'draft.module.ts'), '');
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Модуль-заготовка без нарушений: label и description не заполнены. */
const draft: ArchApp = {
  def: AppDef.define({
    name: 'draft',
    label: 'Заготовка',
    description: 'Приложение с модулем-заготовкой.',
    modules: [
      ModuleDef.define({
        name: 'draft',
        label: 'TODO: название модуля',
        description: 'TODO: что делает модуль',
        dependsOn: [],
        aggregates: [],
        useCases: [],
        reactions: [],
        jobs: [],
      }),
    ],
  }),
  project: root,
  layout: {
    kernel: join(root, 'kernel'),
    domain: join(root, 'domain', '{m}'),
    backend: join(root, 'app', '{m}'),
    assembly: join(root, 'assembly'),
  },
  runners: [],
  graphEntry: join(root, 'draft.graph.ts'),
};

describe('reportArchCheck', () => {
  it('без нарушений — код 0, итог без ссылки на правила', () => {
    expect(run([ExampleArch])).toEqual({
      code: 0,
      lines: ['arch:check example: нарушений — 0', 'arch:check: нарушений нет'],
    });
  });

  it('пустой список приложений не падает', () => {
    expect(run([])).toEqual({ code: 0, lines: ['arch:check: нарушений нет'] });
  });

  it('нарушения — строки с ID правила, путь к rules.md пакета и код 1', () => {
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
    const { code, lines } = run([
      {
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
        graphEntry: '/нет/broken.graph.ts',
      },
    ]);
    expect(code).toBe(1);
    expect(lines).toEqual([
      'arch:check broken: нарушений — 3',
      'MAN-01: модуль broken: пустой label',
      'ARC-06: модуль broken: нет /нет/домена/broken/broken.module.ts',
      'ARC-06: модуль broken: нет /нет/пакета/broken/broken.module.ts',
      'arch:check: нарушений — 3',
      `Правила по ID: ${RULES_DOC}`,
    ]);
  });

  it('незаполненные TODO — предупреждения: список и код 0', () => {
    expect(run([draft])).toEqual({
      code: 0,
      lines: [
        'arch:check draft: нарушений — 0',
        'arch:check draft: незаполненных TODO — 2 (предупреждение)',
        'MAN-01 (предупреждение): модуль draft: label не заполнен — «TODO: название модуля»',
        'MAN-01 (предупреждение): модуль draft: description не заполнен — «TODO: что делает модуль»',
        'arch:check: незаполненных TODO — 2; строгий режим (--strict) считает их нарушениями',
        'arch:check: нарушений нет',
      ],
    });
  });

  it('strict — незаполненные TODO считаются нарушениями, код 1', () => {
    expect(run([draft], { strict: true })).toEqual({
      code: 1,
      lines: [
        'arch:check draft: нарушений — 2',
        'MAN-01: модуль draft: label не заполнен — «TODO: название модуля»',
        'MAN-01: модуль draft: description не заполнен — «TODO: что делает модуль»',
        'arch:check: нарушений — 2',
        `Правила по ID: ${RULES_DOC}`,
      ],
    });
  });

  it('имя в строке отчёта — имя из AppDef', () => {
    expect(run([draft]).lines[0]).toBe('arch:check draft: нарушений — 0');
    const named: ArchApp = {
      ...draft,
      def: AppDef.define({
        name: 'school',
        label: 'Школа',
        description: 'Приложение школы.',
        modules: draft.def.modules,
      }),
    };
    expect(run([named]).lines[0]).toBe('arch:check school: нарушений — 0');
  });

  it('RULES_DOC — путь к rules.md установленного пакета', async () => {
    expect(RULES_DOC).toBe('node_modules/dmg-core/docs/reference/rules.md');
    const text = await Bun.file(
      `${import.meta.dir}/../../docs/reference/rules.md`,
    ).text();
    for (const id of ['MAN-01', 'ARC-06']) expect(text).toContain(`| ${id} |`);
  });

  it('граф не собран — нарушение ARC-13 в отчёте, код 1', () => {
    const clash = new RuleProvider('dmg-core', [new StubRule('RIV-01')]);
    const { code, lines } = run([{ ...ExampleArch, providers: [clash] }]);
    expect(code).toBe(1);
    expect(lines[0]).toBe('arch:check example: нарушений — 1');
    expect(lines[1]).toStartWith(
      'ARC-13: граф приложения example не собран, правила поставщиков не проверены — ',
    );
  });

  it('отказ ARC-13 (ID правила не по форме) — исключение, отчёта нет', () => {
    const bad = new RuleProvider('toy', [new StubRule('toy-1')]);
    const lines: string[] = [];
    expect(() =>
      reportArchCheck([{ ...ExampleArch, providers: [bad] }], (line) =>
        lines.push(line),
      ),
    ).toThrow(
      'ARC-13: правило toy-1 поставщика toy — ID не по форме <ПРЕФИКС>-<NN>',
    );
    expect(lines).toEqual([]);
  });

  it('нарушение поставщика — в общем отчёте со своим ID, код 1', () => {
    const app = { ...ExampleArch, providers: [toyRuleProvider()] };
    expect(run([app])).toEqual({
      code: 1,
      lines: [
        'arch:check example: нарушений — 1',
        'TOY-01: заметка example/toy без вложений',
        'arch:check: нарушений — 1',
        `Правила по ID: ${RULES_DOC}`,
      ],
    });
  });
});
