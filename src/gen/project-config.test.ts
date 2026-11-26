import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig, ProjectConfigError } from './project-config';
import type { RoleTarget } from './project-config.types';

const PREFIX = '.dmg/config.json: ';

/** Сообщение отказа `parse`; сам отказ — `ProjectConfigError` */
function refusal(json: unknown): string {
  try {
    ProjectConfig.parse(json);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    return (error as Error).message;
  }
  throw new Error('ожидался отказ');
}

const gen = (json: unknown) => ProjectConfig.parse({ gen: json }).gen;
const genRefusal = (json: unknown) => refusal({ gen: json });

const MONOREPO = {
  domain: 'domain/src/{m}',
  backend: 'modules/{m}/src',
  domainImport: '@acme/domain/{m}',
  package: '@acme/{m}',
};

let root: string;
const put = (path: string, text: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'project-config-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('read', () => {
  test('нет файлов — undefined', async () => {
    expect(await ProjectConfig.read(root)).toBe(undefined);
  });

  test('конфиг с providers, layers и gen — значения как есть, шаблоны не раскрыты', async () => {
    put(
      '.dmg/config.json',
      JSON.stringify({
        providers: ['acme-ui'],
        layers: {
          ui: { dir: 'frontend/{m}/src', package: '@acme/fe-{m}' },
          tools: { dir: 'tools' },
        },
        gen: MONOREPO,
      }),
    );
    const config = await ProjectConfig.read(root);
    expect(config?.providers).toEqual(['acme-ui']);
    expect(config?.layers).toEqual({
      ui: { dir: 'frontend/{m}/src', package: '@acme/fe-{m}' },
      tools: { dir: 'tools' },
    });
    expect(config?.gen).toEqual(MONOREPO);
  });

  test('есть dmg-core.json — отказ с обоими путями', async () => {
    put('dmg-core.json', '{}');
    const error = await ProjectConfig.read(root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectConfigError);
    expect((error as Error).message).toBe(
      'dmg-core.json переименован в .dmg/config.json — перенеси файл',
    );
  });

  test('оба файла — тот же отказ, новый конфиг не побеждает', async () => {
    put('dmg-core.json', '{}');
    put('.dmg/config.json', '{}');
    const error = await ProjectConfig.read(root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectConfigError);
    expect((error as Error).message).toBe(
      'dmg-core.json переименован в .dmg/config.json — перенеси файл',
    );
  });

  test('битый JSON — отказ с префиксом файла', async () => {
    put('.dmg/config.json', '{ "gen": ');
    const error = await ProjectConfig.read(root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectConfigError);
    expect((error as Error).message).toStartWith(PREFIX);
  });
});

describe('parse: общая форма', () => {
  test('пустой объект — значения по умолчанию', () => {
    const config = ProjectConfig.parse({});
    expect(config.providers).toEqual([]);
    expect(config.layers).toEqual({});
    expect(config.gen).toEqual(ProjectConfig.genDefaults);
    expect(config.skills).toBe(undefined);
    expect(config.roles).toBe(undefined);
    expect(config.instructions).toBe(undefined);
    expect(config.docs).toBe(undefined);
  });

  test('не объект — отказ с полем', () => {
    expect(refusal([])).toBe(`${PREFIX}конфиг — объект`);
    expect(refusal(null)).toBe(`${PREFIX}конфиг — объект`);
    expect(refusal('gen')).toBe(`${PREFIX}конфиг — объект`);
  });

  test('неизвестное поле верхнего уровня', () => {
    expect(refusal({ extra: 1 })).toBe(`${PREFIX}неизвестное поле «extra»`);
  });

  test('конфиг монорепо с целью neutral: skills.dirs, roles.targets neutral, instructions, семь ключей gen', () => {
    const targets: RoleTarget[] = [
      {
        dir: '.agents-core/roles',
        format: 'neutral',
        common: '.agents-core/dmg-core-common.md',
      },
    ];
    const u7 = {
      skills: { dirs: ['.pi/skills'] },
      roles: { targets },
      instructions: 'AGENTS.md',
      gen: {
        kernel: 'platform/kernel/src',
        domain: 'platform/domain/src/{m}',
        backend: 'backend/{m}/src',
        assembly: 'runners/assembly/src',
        domainImport: '@u7-scl/domain/{m}',
        package: '@u7-scl/be-{m}',
        appDef: 'platform/domain/src/open-school.app.ts',
      },
    };
    const config = ProjectConfig.parse(u7);
    expect(config.skills).toEqual({ dirs: ['.pi/skills'] });
    expect(config.roles).toEqual(u7.roles);
    expect(config.instructions).toBe('AGENTS.md');
    expect(config.gen).toEqual(u7.gen);
    expect(config.providers).toEqual([]);
    expect(config.layers).toEqual({});
  });

  test('instructions: null — не вставлять, значение сохраняется', () => {
    expect(ProjectConfig.parse({ instructions: null }).instructions).toBe(null);
  });

  test('roles.targets claude и pi — без поля common', () => {
    const targets: RoleTarget[] = [
      { dir: '.claude/agents', format: 'claude' },
      { dir: '.pi/agents', format: 'pi' },
    ];
    expect(ProjectConfig.parse({ roles: { targets } }).roles?.targets).toEqual(
      targets,
    );
  });

  test.each([
    [{ skills: [] }, 'skills — объект'],
    [{ skills: { x: 1 } }, 'неизвестное поле «skills.x»'],
    [{ skills: { names: 'demo' } }, 'skills.names — массив строк'],
    [{ skills: { dirs: [1] } }, 'skills.dirs — массив строк'],
    [{ roles: 1 }, 'roles — объект'],
    [{ roles: { x: 1 } }, 'неизвестное поле «roles.x»'],
    [{ roles: { names: [null] } }, 'roles.names — массив строк'],
    [{ roles: { targets: {} } }, 'roles.targets — массив целей'],
    [{ roles: { targets: [1] } }, 'roles.targets[0] — объект'],
    [
      { roles: { targets: [{ dir: 'r', format: 'claude', x: 1 }] } },
      'неизвестное поле «roles.targets[0].x»',
    ],
    [
      { roles: { targets: [{ format: 'claude' }] } },
      'roles.targets[0].dir — каталог ролей',
    ],
    [
      { roles: { targets: [{ dir: 'r', format: 'vim' }] } },
      'roles.targets[0].format — neutral, claude или pi',
    ],
    [
      { roles: { targets: [{ dir: 'r', format: 'neutral' }] } },
      'roles.targets[0].common — путь общего блока для neutral',
    ],
    [{ instructions: 1 }, 'instructions — путь файла или null'],
  ])('форма skills, roles, instructions: %#', (config, message) => {
    expect(refusal(config)).toBe(`${PREFIX}${message}`);
  });
});

describe('parse: roles.refs', () => {
  const refsRefusal = (refs: unknown) => refusal({ roles: { refs } });

  test('refs двух ролей — Map в порядке конфига', () => {
    const config = ProjectConfig.parse({
      roles: {
        refs: {
          beta: ['docs/ux.md'],
          alpha: ['docs/domain/index.md', 'docs/ux.md'],
        },
      },
    });
    expect(config.roles?.refs).toEqual(
      new Map([
        ['beta', ['docs/ux.md']],
        ['alpha', ['docs/domain/index.md', 'docs/ux.md']],
      ]),
    );
    expect([...(config.roles?.refs?.keys() ?? [])]).toEqual(['beta', 'alpha']);
  });

  test('refs: {} — допустимо, ссылок нет', () => {
    expect(ProjectConfig.parse({ roles: { refs: {} } }).roles?.refs?.size).toBe(
      0,
    );
  });

  test('нет refs — поля нет', () => {
    expect(ProjectConfig.parse({ roles: {} }).roles?.refs).toBe(undefined);
  });

  test('ключ __proto__ из JSON сохраняется в Map, а не теряется', () => {
    const json = JSON.parse('{"roles":{"refs":{"__proto__":["a.md"]}}}');
    expect(ProjectConfig.parse(json).roles?.refs).toEqual(
      new Map([['__proto__', ['a.md']]]),
    );
  });

  test.each([
    [[], 'roles.refs — объект «роль → список путей»'],
    ['docs/ux.md', 'roles.refs — объект «роль → список путей»'],
    [null, 'roles.refs — объект «роль → список путей»'],
    [
      { alpha: 'docs/ux.md' },
      'roles.refs.alpha — непустой массив путей (нет ссылок — убери ключ)',
    ],
    [
      { alpha: [] },
      'roles.refs.alpha — непустой массив путей (нет ссылок — убери ключ)',
    ],
    [{ alpha: [1] }, 'roles.refs.alpha[0] — непустой путь'],
    [{ alpha: ['a.md', ''] }, 'roles.refs.alpha[1] — непустой путь'],
  ])('форма refs: %#', (refs, message) => {
    expect(refsRefusal(refs)).toBe(`${PREFIX}${message}`);
  });

  test.each([
    ['абсолютный', '/abs.md'],
    ['выход за корень', '../x.md'],
  ])('путь %s — отказ с полем', (_name, path) => {
    expect(refsRefusal({ alpha: [path] })).toBe(
      `${PREFIX}roles.refs.alpha[0] — путь внутри проекта, от его корня`,
    );
  });

  test.each([
    ['с ./', './x.md', 'x.md'],
    ['с //', 'a//b.md', 'a/b.md'],
    ['с .. внутри', 'a/../b.md', 'b.md'],
  ])('путь %s — не в нормальной форме: отказ', (_name, path, normal) => {
    expect(refsRefusal({ alpha: [path] })).toBe(
      `${PREFIX}roles.refs.alpha[0] — путь в нормальной форме: ${normal}`,
    );
  });

  test.each([
    ['docs/', 'файл, не каталог (убери «/» в конце)'],
    ['.', 'файл, не каталог: это корень проекта'],
  ])('каталог «%s» — отказ: ссылка — файл', (path, message) => {
    expect(refsRefusal({ alpha: [path] })).toBe(
      `${PREFIX}roles.refs.alpha[0] — ${message}`,
    );
  });

  test('якорь «#» — отказ: лист целиком (DOC-03)', () => {
    expect(refsRefusal({ alpha: ['docs/ux.md#a'] })).toBe(
      `${PREFIX}roles.refs.alpha[0] — без якоря: лист целиком (DOC-03)`,
    );
  });

  test.each([
    ['перевод строки', 'a\nb.md'],
    ['управляющий знак', 'a\u0001b.md'],
    ['бэктик', 'a`b.md'],
    ['неразрывный пробел', 'a\u00a0b.md'],
    ['NEL', 'a\u0085b.md'],
    ['bidi', 'a\u202eb.md'],
    ['DEL', 'a\x7fb.md'],
    ['разделитель строк', 'a\u2028b.md'],
  ])(
    'путь с символом «%s» — отказ: путь попадает в текст промпта',
    (_n, path) => {
      expect(refsRefusal({ alpha: [path] })).toBe(
        `${PREFIX}roles.refs.alpha[0] — без управляющих знаков и «\`» (путь попадает в промпт)`,
      );
    },
  );

  test('обычный пробел в пути — допустим', () => {
    expect(
      ProjectConfig.parse({ roles: { refs: { alpha: ['a b.md'] } } }).roles
        ?.refs,
    ).toEqual(new Map([['alpha', ['a b.md']]]));
  });

  test('повтор пути в списке роли — отказ; у другой роли — можно', () => {
    expect(refsRefusal({ alpha: ['a.md', 'b.md', 'a.md'] })).toBe(
      `${PREFIX}roles.refs.alpha[2] — путь повторяется: a.md`,
    );
    expect(
      ProjectConfig.parse({
        roles: { refs: { alpha: ['a.md'], beta: ['a.md'] } },
      }).roles?.refs?.size,
    ).toBe(2);
  });
});

describe('parse: providers', () => {
  test('список поставщиков — как есть', () => {
    expect(
      ProjectConfig.parse({ providers: ['acme-ui', 'acme-ops'] }).providers,
    ).toEqual(['acme-ui', 'acme-ops']);
    expect(ProjectConfig.parse({ providers: [] }).providers).toEqual([]);
  });

  test.each([
    ['не массив', 'acme-ui'],
    ['не строка в списке', ['acme-ui', 1]],
    ['пустая строка', ['']],
    ['повтор', ['acme-ui', 'acme-ui']],
    ['dmg-core в списке', ['acme-ui', 'dmg-core']],
  ])('отказ: %s', (_name, providers) => {
    expect(refusal({ providers })).toStartWith(`${PREFIX}providers`);
  });
});

describe('parse: layers', () => {
  test('место слоя: dir, package при dir на /src, {m} в package при {m} в dir', () => {
    const layers = {
      ui: { dir: 'frontend/{m}/src', package: '@acme/fe-{m}' },
      one: { dir: 'shared/src', package: '@acme/shared' },
      tools: { dir: 'tools' },
    };
    expect(ProjectConfig.parse({ layers }).layers).toEqual(layers);
  });

  test('не объект — отказ', () => {
    for (const layers of [[], 'ui', null, 1]) {
      expect(refusal({ layers })).toStartWith(`${PREFIX}layers`);
    }
  });

  test('место слоя не объект — отказ с именем слоя', () => {
    expect(refusal({ layers: { ui: 'frontend' } })).toStartWith(
      `${PREFIX}layers.ui`,
    );
    expect(refusal({ layers: { ui: ['frontend'] } })).toStartWith(
      `${PREFIX}layers.ui`,
    );
  });

  test('лишний ключ — неизвестное поле с путём', () => {
    expect(refusal({ layers: { ui: { dir: 'ui', root: '.' } } })).toBe(
      `${PREFIX}неизвестное поле «layers.ui.root»`,
    );
  });

  test('dir: нет, не строка или пустая — отказ с полем', () => {
    for (const place of [{}, { dir: 1 }, { dir: '' }]) {
      expect(refusal({ layers: { ui: place } })).toStartWith(
        `${PREFIX}layers.ui.dir`,
      );
    }
  });

  test('package не строка или пустая — отказ с полем', () => {
    for (const pkg of [1, '']) {
      expect(
        refusal({ layers: { ui: { dir: 'ui/src', package: pkg } } }),
      ).toStartWith(`${PREFIX}layers.ui.package`);
    }
  });

  test('package без /src в конце dir — отказ', () => {
    expect(
      refusal({ layers: { ui: { dir: 'frontend/ui', package: '@acme/ui' } } }),
    ).toStartWith(`${PREFIX}layers.ui.package`);
  });

  test('{m} в package без {m} в dir — отказ', () => {
    expect(
      refusal({
        layers: { ui: { dir: 'frontend/src', package: '@acme/fe-{m}' } },
      }),
    ).toStartWith(`${PREFIX}layers.ui.package`);
  });
});

describe('parse: gen', () => {
  test('шаблоны поверх значений по умолчанию', () => {
    expect(gen({ backend: 'p/{m}' })).toEqual({
      domain: 'src/platform/domain/{m}',
      backend: 'p/{m}',
    });
  });

  test('genDefaults — домен и реализация по умолчанию', () => {
    expect(ProjectConfig.genDefaults).toEqual({
      domain: 'src/platform/domain/{m}',
      backend: 'src/backend/{m}',
    });
  });

  test('ошибки с полем', () => {
    expect(genRefusal([])).toBe(`${PREFIX}gen — объект`);
    expect(genRefusal({ domain: 'src/domain' })).toBe(
      `${PREFIX}gen.domain — шаблон пути с {m}`,
    );
    expect(genRefusal({ backend: 'src/app' })).toBe(
      `${PREFIX}gen.backend — шаблон пути с {m}`,
    );
    expect(genRefusal({ domainImport: 1 })).toBe(
      `${PREFIX}gen.domainImport — шаблон с {m}`,
    );
    expect(genRefusal({ root: '.' })).toBe(
      `${PREFIX}неизвестное поле «gen.root»`,
    );
  });

  test('старые ключи: ошибка с новым именем, раньше неизвестного поля', () => {
    expect(genRefusal({ app: 'src/backend/{m}' })).toBe(
      `${PREFIX}gen.app переименован в gen.backend`,
    );
    expect(genRefusal({ compositionRoot: 'src/app' })).toBe(
      `${PREFIX}gen.compositionRoot переименован в gen.assembly`,
    );
    expect(genRefusal({ root: '.', app: 'p/{m}' })).toBe(
      `${PREFIX}gen.app переименован в gen.backend`,
    );
  });

  test('gen.package: шаблон имени пакета модуля', () => {
    expect(gen(MONOREPO)).toEqual(MONOREPO);
  });

  test('ошибки gen.package', () => {
    expect(genRefusal({ ...MONOREPO, package: '@acme/todo' })).toBe(
      `${PREFIX}gen.package — шаблон имени пакета с {m}`,
    );
    expect(genRefusal({ ...MONOREPO, backend: 'modules/{m}' })).toBe(
      `${PREFIX}gen.package — gen.backend должен оканчиваться на /src`,
    );
    const { domainImport: _, ...noImport } = MONOREPO;
    expect(genRefusal(noImport)).toBe(
      `${PREFIX}gen.package — нужен gen.domainImport`,
    );
  });

  test('gen.assembly: каталог сборки без {m}', () => {
    expect(gen({ assembly: 'app/src' }).assembly).toBe('app/src');
    expect(genRefusal({ assembly: 'a/{m}' })).toBe(
      `${PREFIX}gen.assembly — путь каталога без {m}`,
    );
    expect(genRefusal({ assembly: 1 })).toBe(
      `${PREFIX}gen.assembly — путь каталога без {m}`,
    );
  });

  test('gen.kernel: каталог kernel без {m}', () => {
    expect(gen({ kernel: 'platform/kernel' }).kernel).toBe('platform/kernel');
    expect(genRefusal({ kernel: 'k/{m}' })).toBe(
      `${PREFIX}gen.kernel — путь каталога без {m}`,
    );
    expect(genRefusal({ kernel: 1 })).toBe(
      `${PREFIX}gen.kernel — путь каталога без {m}`,
    );
  });

  test('gen.appDef: путь файла AppDef без {m}', () => {
    expect(gen({ appDef: 'src/domain/acme.app.ts' }).appDef).toBe(
      'src/domain/acme.app.ts',
    );
    expect(genRefusal({ appDef: 'src/{m}.app.ts' })).toBe(
      `${PREFIX}gen.appDef — путь файла без {m}`,
    );
    expect(genRefusal({ appDef: 1 })).toBe(
      `${PREFIX}gen.appDef — путь файла без {m}`,
    );
  });
});

describe('parse: docs', () => {
  const docsRefusal = (json: unknown) => refusal({ docs: json });

  test('полная форма — как есть', () => {
    const docs = {
      entries: ['llms.txt', 'docs/start.md'],
      exempt: [
        {
          path: 'docs/graph-format.md',
          reason: 'один формат документа: разрез рвёт описание полей',
        },
        { path: 'docs/wide/', reason: 'каталог формата' },
      ],
      generated: ['docs/state/', 'docs/state.md'],
      limits: { entry: 40, index: 70, leaf: 200, caption: 100 },
    };
    expect(ProjectConfig.parse({ docs }).docs).toEqual(docs);
  });

  test('пустой объект и частичные поля — как есть', () => {
    expect(ProjectConfig.parse({ docs: {} }).docs).toEqual({});
    expect(
      ProjectConfig.parse({ docs: { limits: { leaf: 200 } } }).docs,
    ).toEqual({
      limits: { leaf: 200 },
    });
    expect(
      ProjectConfig.parse({ docs: { exempt: [], generated: [] } }).docs,
    ).toEqual({
      exempt: [],
      generated: [],
    });
  });

  test('секция читается из файла вместе с прочими', async () => {
    put(
      '.dmg/config.json',
      JSON.stringify({
        providers: ['acme-ui'],
        docs: { entries: ['START.md'] },
      }),
    );
    const config = await ProjectConfig.read(root);
    expect(config?.docs).toEqual({ entries: ['START.md'] });
    expect(config?.providers).toEqual(['acme-ui']);
  });

  test.each([
    ['не объект', 'docs', 'docs'],
    ['массив', ['llms.txt'], 'docs'],
    ['null', null, 'docs'],
  ])('docs — %s: отказ с полем', (_name, json, field) => {
    expect(docsRefusal(json)).toStartWith(`${PREFIX}${field}`);
  });

  test('неизвестное поле: docs, docs.limits, элемент docs.exempt', () => {
    expect(docsRefusal({ extra: 1 })).toBe(
      `${PREFIX}неизвестное поле «docs.extra»`,
    );
    expect(docsRefusal({ limits: { extra: 1 } })).toBe(
      `${PREFIX}неизвестное поле «docs.limits.extra»`,
    );
    expect(
      docsRefusal({ exempt: [{ path: 'a.md', reason: 'r', extra: 1 }] }),
    ).toBe(`${PREFIX}неизвестное поле «docs.exempt[0].extra»`);
  });

  test.each([
    ['не массив', 'llms.txt'],
    ['пустой массив', []],
    ['пустая строка', ['llms.txt', '']],
    ['не строка', [1]],
  ])('entries: %s — отказ с полем', (_name, entries) => {
    const message = docsRefusal({ entries });
    expect(message).toStartWith(`${PREFIX}docs.entries`);
    expect(message).not.toContain('DOC-05');
  });

  test.each([
    ['generated не массив', { generated: 'docs/state/' }, 'docs.generated'],
    ['generated: пустая строка', { generated: [''] }, 'docs.generated'],
    [
      'generated: не строка',
      { generated: ['docs/state/', 2] },
      'docs.generated',
    ],
    [
      'exempt не массив',
      { exempt: { path: 'a.md', reason: 'r' } },
      'docs.exempt',
    ],
    ['limits не объект', { limits: 5 }, 'docs.limits'],
    ['элемент exempt не объект', { exempt: ['a.md'] }, 'docs.exempt[0]'],
    [
      'у элемента exempt нет path',
      { exempt: [{ reason: 'r' }] },
      'docs.exempt[0].path',
    ],
    [
      'path не строка',
      { exempt: [{ path: 1, reason: 'r' }] },
      'docs.exempt[0].path',
    ],
    [
      'path пустой',
      { exempt: [{ path: '', reason: 'r' }] },
      'docs.exempt[0].path',
    ],
  ])('форма: %s — отказ с полем, без ID правила', (_name, docs, field) => {
    const message = docsRefusal(docs);
    expect(message).toStartWith(`${PREFIX}${field}`);
    expect(message).not.toContain('DOC-05');
  });

  test.each([
    ['нет reason', { path: 'a.md' }],
    ['пустой reason', { path: 'a.md', reason: '' }],
    ['reason из пробелов', { path: 'a.md', reason: '  \t\n ' }],
    ['reason не строка', { path: 'a.md', reason: 3 }],
  ])('exempt: %s — отказ (DOC-05)', (_name, item) => {
    const message = docsRefusal({ exempt: [item] });
    expect(message).toStartWith(`${PREFIX}docs.exempt[0].reason`);
    expect(message).toContain('(DOC-05)');
  });

  test('отказ называет индекс элемента exempt', () => {
    const message = docsRefusal({
      exempt: [{ path: 'a.md', reason: 'r' }, { path: 'b.md' }],
    });
    expect(message).toStartWith(`${PREFIX}docs.exempt[1].reason`);
  });

  test.each([
    ['нуль', 0],
    ['отрицательное', -1],
    ['дробное', 1.5],
    ['строка', '5'],
    ['null', null],
    ['логическое', true],
  ])('limits.*: %s — не целое больше нуля', (_name, value) => {
    for (const key of ['entry', 'index', 'leaf', 'caption']) {
      const message = docsRefusal({ limits: { [key]: value } });
      expect(message).toStartWith(`${PREFIX}docs.limits.${key}`);
      expect(message).not.toContain('DOC-05');
    }
  });

  test('limits.*: единица — допустима', () => {
    const limits = { entry: 1, index: 1, leaf: 1, caption: 1 };
    expect(ProjectConfig.parse({ docs: { limits } }).docs?.limits).toEqual(
      limits,
    );
  });

  test.each([
    ['абсолютный', '/etc/llms.txt'],
    ['выход за корень', '../llms.txt'],
    ['выход за корень в середине', 'docs/../../llms.txt'],
  ])('entries, generated: путь %s — отказ с полем', (_name, path) => {
    const entries = docsRefusal({ entries: ['llms.txt', path] });
    expect(entries).toStartWith(`${PREFIX}docs.entries[1]`);
    const generated = docsRefusal({ generated: [path] });
    expect(generated).toStartWith(`${PREFIX}docs.generated[0]`);
  });

  test.each([
    ['абсолютный', '/etc/passwd'],
    ['выход за корень', '../docs/a.md'],
    ['выход за корень в середине', 'docs/../../a.md'],
  ])('exempt.path: %s — отказ (DOC-05)', (_name, path) => {
    const message = docsRefusal({ exempt: [{ path, reason: 'причина' }] });
    expect(message).toStartWith(`${PREFIX}docs.exempt[0].path`);
    expect(message).toContain('(DOC-05)');
  });

  test.each([
    ['с «./»', './llms.txt'],
    ['с «./» в середине', 'docs/./a.md'],
    ['с «..» внутри корня', 'docs/x/../a.md'],
    ['с двойным «/»', 'docs//a.md'],
  ])('путь %s — не в нормальной форме: отказ с полем', (_name, path) => {
    const entries = docsRefusal({ entries: ['llms.txt', path] });
    expect(entries).toStartWith(`${PREFIX}docs.entries[1]`);
    expect(entries).not.toContain('DOC-05');
    const generated = docsRefusal({ generated: [path] });
    expect(generated).toStartWith(`${PREFIX}docs.generated[0]`);
    expect(generated).not.toContain('DOC-05');
    const exempt = docsRefusal({ exempt: [{ path, reason: 'причина' }] });
    expect(exempt).toStartWith(`${PREFIX}docs.exempt[0].path`);
    expect(exempt).toContain('(DOC-05)');
  });

  test('каталог с «/» на конце — нормальная форма', () => {
    const docs = {
      generated: ['docs/state/'],
      exempt: [{ path: 'docs/wide/', reason: 'причина' }],
    };
    expect(ProjectConfig.parse({ docs }).docs).toEqual(docs);
  });

  test('повтор в entries — отказ с полем и путём', () => {
    const message = docsRefusal({ entries: ['llms.txt', 'a.md', 'llms.txt'] });
    expect(message).toStartWith(`${PREFIX}docs.entries[2]`);
    expect(message).toContain('llms.txt');
  });
});
