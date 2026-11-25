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
  });

  test('не объект — отказ с полем', () => {
    expect(refusal([])).toBe(`${PREFIX}конфиг — объект`);
    expect(refusal(null)).toBe(`${PREFIX}конфиг — объект`);
    expect(refusal('gen')).toBe(`${PREFIX}конфиг — объект`);
  });

  test('неизвестное поле верхнего уровня', () => {
    expect(refusal({ extra: 1 })).toBe(`${PREFIX}неизвестное поле «extra»`);
  });

  test('конфиг формы u7-school: skills.dirs, roles.targets neutral, instructions, семь ключей gen', () => {
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
