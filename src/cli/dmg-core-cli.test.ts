import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put, role } from './cli.test-kit';
import { DmgCoreCli } from './dmg-core-cli';
import { Marker } from './marker';
import { PackageSource } from './package-source';
import { RoleRefs } from './role-refs';

const PACKAGE_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
  'skills/demo/SKILL.md': '---\nname: demo\ndescription: d\n---\n\nСкил.\n',
  'skills/demo/ref/notes.md': 'Заметки.\n',
  'agents/roles/alpha.md': role('alpha'),
  'agents/roles/beta.md': role('beta'),
  'agents/common.md': 'Общий блок пакета.\n',
};

const LEGACY = {
  ok: false,
  messages: ['dmg-core.json переименован в .dmg/config.json — перенеси файл'],
};

let work: string;
let pkgRoot: string;
let root: string;

const read = (path: string) => readFile(join(root, path), 'utf8');
const write = (path: string, text: string) => put(root, { [path]: text });

async function cli(version = '1.0.0'): Promise<DmgCoreCli> {
  await put(pkgRoot, {
    'package.json': JSON.stringify({
      name: 'dmg-core',
      version,
      peerDependencies: { valibot: '^1.5.0' },
    }),
  });
  return new DmgCoreCli(await PackageSource.load(pkgRoot));
}

async function snapshot(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const path of new Bun.Glob('**/*').scan({
    cwd: root,
    dot: true,
  })) {
    files.set(path, await read(path));
  }
  return files;
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'dmg-core-cli-'));
  pkgRoot = join(work, 'pkg');
  root = join(work, 'project');
  await put(pkgRoot, PACKAGE_FILES);
  await mkdir(root);
});

afterEach(() => rm(work, { recursive: true, force: true }));

describe('init', () => {
  test('пустой проект: конфиг по умолчанию, копии для Claude Code, вставка', async () => {
    const result = await (await cli()).init(root);
    expect(result).toEqual({ ok: true, messages: [] });

    expect(JSON.parse(await read('.dmg/config.json'))).toEqual({
      skills: { names: ['demo'], dirs: ['.claude/skills'] },
      roles: {
        names: ['alpha', 'beta'],
        targets: [{ dir: '.claude/agents', format: 'claude' }],
      },
      instructions: 'AGENTS.md',
      gen: { domain: 'src/platform/domain/{m}', backend: 'src/backend/{m}' },
    });
    const skill = await read('.claude/skills/demo/SKILL.md');
    expect(Marker.versionOf(skill)).toBe('1.0.0');
    expect(Marker.strip(await read('.claude/skills/demo/ref/notes.md'))).toBe(
      'Заметки.\n',
    );
    const alpha = await read('.claude/agents/alpha.md');
    expect(alpha).toContain('tools: Read, Bash\n');
    expect(alpha).toEndWith('Общий блок пакета.\n');
    expect(await read('AGENTS.md')).toContain('node_modules/dmg-core/llms.txt');
    expect(existsSync(join(root, 'dmg-core.json'))).toBe(false);
    expect(await (await cli()).check(root)).toEqual({ ok: true, messages: [] });
  });

  test.each([
    ['без --profile', []],
    ['с --profile', ['--profile', 'single', '--name', 'acme']],
  ])('%s: dmg-core.json — отказ, ничего не записано', async (_name, argv) => {
    await write('dmg-core.json', '{}\n');
    const before = await snapshot();
    expect(await (await cli()).init(root, argv)).toEqual(LEGACY);
    expect(await snapshot()).toEqual(before);
    expect(existsSync(join(root, '.dmg'))).toBe(false);
  });

  test('идемпотентен и не трогает существующий конфиг и текст инструкций', async () => {
    await write('AGENTS.md', '# Правила проекта\n');
    await write(
      '.dmg/config.json',
      JSON.stringify({ roles: { names: ['beta'] }, instructions: 'AGENTS.md' }),
    );
    await (await cli()).init(root);
    const first = await snapshot();
    expect(await (await cli()).init(root)).toEqual({ ok: true, messages: [] });
    expect(await snapshot()).toEqual(first);

    expect(first.has('.claude/agents/alpha.md')).toBe(false);
    expect(first.get('AGENTS.md')).toStartWith('# Правила проекта\n\n');
    expect(JSON.parse(first.get('.dmg/config.json') ?? '')).toEqual({
      roles: { names: ['beta'] },
      instructions: 'AGENTS.md',
    });
  });
});

describe('sync и check', () => {
  test('без .dmg/config.json — не ok, подсказка про init', async () => {
    const result = await (await cli()).check(root);
    expect(result.ok).toBe(false);
    expect(result.messages).toEqual([
      'нет .dmg/config.json — запусти dmg-core init',
    ]);
  });

  test('dmg-core.json — отказ sync и check с новым путём, ничего не записано', async () => {
    await write('dmg-core.json', '{}\n');
    const before = await snapshot();
    expect(await (await cli()).sync(root)).toEqual(LEGACY);
    expect(await (await cli()).check(root)).toEqual(LEGACY);
    expect(await snapshot()).toEqual(before);
  });

  test('providers: [] и layers — sync ok, слои доставку не меняют', async () => {
    await write(
      '.dmg/config.json',
      JSON.stringify({
        providers: [],
        layers: { ui: { dir: 'frontend/{m}/src', package: '@acme/fe-{m}' } },
      }),
    );
    expect(await (await cli()).sync(root)).toEqual({ ok: true, messages: [] });
    expect(await (await cli()).check(root)).toEqual({ ok: true, messages: [] });
  });

  test('check: нет копии, правка руками, вставки нет', async () => {
    await (await cli()).init(root);
    await rm(join(root, '.claude/agents/beta.md'));
    await write(
      '.claude/agents/alpha.md',
      `${await read('.claude/agents/alpha.md')}+`,
    );
    await write('AGENTS.md', '# Пусто\n');

    const result = await (await cli()).check(root);
    expect(result.ok).toBe(false);
    expect(result.messages).toEqual([
      'расходится с пакетом (правлена руками?): .claude/agents/alpha.md',
      'нет копии: .claude/agents/beta.md',
      'нет вставки dmg-core или она устарела: AGENTS.md',
    ]);
  });

  test('новая версия пакета: check сообщает об устаревших копиях, sync обновляет', async () => {
    await (await cli()).init(root);
    const next = await cli('1.1.0');
    const result = await next.check(root);
    expect(result.ok).toBe(false);
    expect(result.messages).toContain(
      'устарела (1.0.0 → 1.1.0): .claude/agents/alpha.md',
    );
    expect(result.messages).toContain(
      'нет вставки dmg-core или она устарела: AGENTS.md',
    );
    expect(await next.sync(root)).toEqual({ ok: true, messages: [] });
    expect(await next.check(root)).toEqual({ ok: true, messages: [] });
  });

  test('sync удаляет свою копию, исключённую из конфига; чужие файлы не трогает', async () => {
    await (await cli()).init(root);
    await write('.claude/agents/own.md', 'Своя роль проекта.\n');
    await write(
      '.dmg/config.json',
      JSON.stringify({ skills: { names: [] }, roles: { names: ['beta'] } }),
    );

    const check = await (await cli()).check(root);
    expect(check.messages).toEqual([
      'копия без источника: .claude/agents/alpha.md',
      'копия без источника: .claude/skills/demo',
    ]);
    expect(await (await cli()).sync(root)).toEqual({ ok: true, messages: [] });
    const files = await snapshot();
    expect(files.has('.claude/agents/alpha.md')).toBe(false);
    expect(files.has('.claude/skills/demo/SKILL.md')).toBe(false);
    expect(files.get('.claude/agents/own.md')).toBe('Своя роль проекта.\n');
  });

  test('ручной файл на месте копии — не перезаписывается, не ok', async () => {
    await write('.claude/agents/alpha.md', 'Ручная alpha.\n');
    const result = await (await cli()).init(root);
    expect(result.ok).toBe(false);
    expect(result.messages).toEqual([
      'файл не от dmg-core (удали его или исключи роль/скил в .dmg/config.json): .claude/agents/alpha.md',
    ]);
    expect(await read('.claude/agents/alpha.md')).toBe('Ручная alpha.\n');
    expect(Marker.versionOf(await read('.claude/agents/beta.md'))).toBe(
      '1.0.0',
    );
  });

  test('цель neutral: исходник роли с меткой и общий блок отдельным файлом', async () => {
    await write(
      '.dmg/config.json',
      JSON.stringify({
        skills: { dirs: ['.pi/skills'] },
        roles: {
          targets: [
            { dir: 'roles', format: 'neutral', common: 'dmg-core-common.md' },
            { dir: '.pi/agents', format: 'pi' },
          ],
        },
        instructions: null,
      }),
    );
    expect(await (await cli()).sync(root)).toEqual({ ok: true, messages: [] });
    expect(Marker.strip(await read('roles/alpha.md'))).toBe(role('alpha'));
    expect(Marker.strip(await read('dmg-core-common.md'))).toBe(
      'Общий блок пакета.\n',
    );
    expect(await read('.pi/agents/alpha.md')).toContain('tools: read, bash\n');
    expect((await snapshot()).has('AGENTS.md')).toBe(false);
  });

  test.each([
    [
      { roles: { names: ['gamma'] } },
      '.dmg/config.json: нет роли «gamma» в пакете',
    ],
    [{ skills: { names: ['x'] } }, '.dmg/config.json: нет скила «x» в пакете'],
    [
      { roles: { targets: [{ dir: 'r', format: 'vim' }] } },
      '.dmg/config.json: roles.targets[0].format — neutral, claude или pi',
    ],
  ])(
    'ошибка конфига — не ok, сообщение с префиксом файла: %#',
    async (config, message) => {
      await write('.dmg/config.json', JSON.stringify(config));
      expect(await (await cli()).sync(root)).toEqual({
        ok: false,
        messages: [message],
      });
    },
  );
});

describe('roles.refs: связка', () => {
  const PATHS = ['docs/ux.md', 'docs/domain/index.md'];

  async function project(files: Record<string, string>) {
    await write(
      '.dmg/config.json',
      JSON.stringify({
        roles: {
          targets: [
            { dir: 'roles', format: 'neutral', common: 'dmg-core-common.md' },
            { dir: '.pi/agents', format: 'pi' },
          ],
          refs: { alpha: PATHS },
        },
        skills: { dirs: ['.pi/skills'] },
      }),
    );
    await put(root, files);
  }
  const refs = () => new RoleRefs(new Map([['alpha', PATHS]]));
  const block = () => refs().block('alpha');
  /** Сообщение CLI о битых ссылках — текст владельца `RoleRefs`; ждём ровно одно */
  async function broken(): Promise<string[]> {
    const lines = (await refs().broken(root)).map(
      (finding) => `${finding.message}: ${finding.path}`,
    );
    expect(lines).toHaveLength(1);
    return lines;
  }

  test('блок «Знания проекта» — в копиях neutral и pi у alpha, у beta нет; повторный sync ничего не меняет', async () => {
    await project({
      'docs/ux.md': 'Лист.\n',
      'docs/domain/index.md': 'Оглавление.\n',
    });
    expect(await (await cli()).sync(root)).toEqual({ ok: true, messages: [] });

    expect(Marker.strip(await read('roles/alpha.md'))).toBe(
      `${role('alpha').trimEnd()}\n\n${block()}\n`,
    );
    expect(await read('.pi/agents/alpha.md')).toContain(
      `Промпт alpha.\n\n${block()}\n\nОбщий блок пакета.\n`,
    );
    expect(await read('roles/beta.md')).not.toContain('Знания проекта');
    expect(await read('.pi/agents/beta.md')).not.toContain('Знания проекта');
    expect(await read('dmg-core-common.md')).not.toContain('Знания проекта');

    const before = await snapshot();
    expect(await (await cli()).sync(root)).toEqual({ ok: true, messages: [] });
    expect(await snapshot()).toEqual(before);
    expect(await (await cli()).check(root)).toEqual({ ok: true, messages: [] });
  });

  test('sync с битой ссылкой — не ok с сообщением, ничего не записано', async () => {
    await project({
      'docs/domain/index.md': 'Оглавление.\n',
      'AGENTS.md': '# Проект\n',
    });
    const before = await snapshot();
    const messages = await broken();
    expect(await (await cli()).sync(root)).toEqual({ ok: false, messages });
    expect(await snapshot()).toEqual(before);
  });

  test('check с битой ссылкой — не ok, то же сообщение', async () => {
    await project({
      'docs/ux.md': 'Лист.\n',
      'docs/domain/index.md': 'Оглавление.\n',
    });
    await (await cli()).sync(root);
    await rm(join(root, 'docs/ux.md'));
    const messages = await broken();
    expect(await (await cli()).check(root)).toEqual({ ok: false, messages });
  });
});

describe('gen', () => {
  test('без .dmg/config.json — раскладка по умолчанию, импорт домена относительный', async () => {
    const result = await (await cli()).gen(root, ['module', 'todo', '--write']);
    expect(result.ok).toBe(true);
    expect(result.messages).toContain(
      `Создан: ${join(root, 'src/backend/todo/todo.module.ts')}`,
    );
    expect(await read('src/platform/domain/todo/todo.module.ts')).toContain(
      "name: 'todo'",
    );
    expect(await read('src/backend/todo/todo.module.ts')).toContain(
      "import { TodoModuleDef } from '../../platform/domain/todo';",
    );
  });

  test('dmg-core.json — отказ, а не раскладка по умолчанию; ничего не записано', async () => {
    await write('dmg-core.json', '{}\n');
    const before = await snapshot();
    expect(
      await (await cli()).gen(root, ['module', 'todo', '--write']),
    ).toEqual(LEGACY);
    expect(await snapshot()).toEqual(before);
  });

  test('секция gen в .dmg/config.json задаёт каталоги и импорт домена', async () => {
    await write(
      '.dmg/config.json',
      JSON.stringify({
        gen: {
          domain: 'packages/domain/src/{m}',
          backend: 'packages/{m}/src',
          domainImport: '@acme/domain/{m}',
        },
      }),
    );
    const result = await (await cli()).gen(root, ['module', 'todo', '--write']);
    expect(result.ok).toBe(true);
    expect(await read('packages/domain/src/todo/contract.ts')).toContain(
      'TodoModuleDef',
    );
    expect(await read('packages/todo/src/todo.module.ts')).toContain(
      "import { TodoModuleDef } from '@acme/domain/todo';",
    );
  });

  test('gen.package — пакет модуля с dmg-core версии пакета', async () => {
    await write(
      '.dmg/config.json',
      JSON.stringify({
        gen: {
          domain: 'domain/src/{m}',
          backend: 'modules/{m}/src',
          domainImport: '@acme/domain/{m}',
          package: '@acme/{m}',
        },
      }),
    );
    const result = await (await cli('1.2.3')).gen(root, [
      'module',
      'todo',
      '--write',
    ]);
    expect(result.ok).toBe(true);
    expect(JSON.parse(await read('modules/todo/package.json'))).toMatchObject({
      name: '@acme/todo',
      dependencies: {
        'dmg-core': '^1.2.3',
        valibot: '^1.5.0',
        '@acme/domain': 'workspace:*',
      },
    });
  });

  test('gen.package и нет версии valibot в пакете — сообщение о поставке, не исключение', async () => {
    await write(
      '.dmg/config.json',
      JSON.stringify({
        gen: {
          domain: 'domain/src/{m}',
          backend: 'modules/{m}/src',
          domainImport: '@acme/domain/{m}',
          package: '@acme/{m}',
        },
      }),
    );
    await put(pkgRoot, {
      'package.json': JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
    });
    const broken = new DmgCoreCli(await PackageSource.load(pkgRoot));
    const result = await broken.gen(root, ['module', 'todo', '--write']);
    expect(result).toEqual({
      ok: false,
      messages: [
        'Ошибка поставки dmg-core (переустанови пакет): gen.package: нет версии valibot для пакета модуля',
      ],
    });
    expect(existsSync(join(root, 'domain'))).toBe(false);
  });

  test('ошибка конфига gen — отказ с полем, ничего не записано', async () => {
    await write(
      '.dmg/config.json',
      JSON.stringify({ gen: { domain: 'src/domain' } }),
    );
    const before = await snapshot();
    expect(
      await (await cli()).gen(root, ['module', 'todo', '--write']),
    ).toEqual({
      ok: false,
      messages: ['.dmg/config.json: gen.domain — шаблон пути с {m}'],
    });
    expect(await snapshot()).toEqual(before);
  });

  test('ошибка генератора — не ok, ничего не записано', async () => {
    const result = await (await cli()).gen(root, ['uc', 'todo.task', 'add']);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toStartWith('Ошибка: Модуль «todo» не найден');
    expect(await snapshot()).toEqual(new Map());
  });
});
