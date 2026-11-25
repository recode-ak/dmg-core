import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXAMPLE_PROVIDER,
  installProvider,
  linkExampleProvider,
  put,
  role,
  skill,
} from './cli.test-kit';
import { DmgCoreCli } from './dmg-core-cli';
import { Marker } from './marker';
import { PackageSource } from './package-source';

// `sync`, `check` и `gen` с поставщиками (`providers` в .dmg/config.json).
// `node_modules` проекта собирается до первого вызова CLI: промах
// `Bun.resolveSync` кэшируется на процесс, «поставили после» не моделируем.

const PACKAGE_FILES: Record<string, string> = {
  ...skill('demo'),
  'agents/roles/alpha.md': role('alpha'),
  'agents/roles/beta.md': role('beta'),
  'agents/common.md': 'Общий блок пакета.\n',
};

const PROVIDERS = '.dmg/config.json: providers';
const OK = { ok: true, messages: [] };
const notFound = (name: string) =>
  `${PROVIDERS} — пакет «${name}» не найден от корня проекта (нет входа ${name}/dmg-core)`;

let work: string;
let pkgRoot: string;
let root: string;

const read = (path: string) => readFile(join(root, path), 'utf8');
const write = (path: string, text: string) => put(root, { [path]: text });
const config = (body: object) =>
  write('.dmg/config.json', JSON.stringify(body));
const install = (name: string, files?: Record<string, string>, v?: string) =>
  installProvider(root, name, files, v);

/** Временный `dmg-core`; files — дополнение к PACKAGE_FILES */
async function cli(
  version = '1.0.0',
  files: Record<string, string> = {},
): Promise<DmgCoreCli> {
  await put(pkgRoot, {
    ...PACKAGE_FILES,
    ...files,
    'package.json': JSON.stringify({
      name: 'dmg-core',
      version,
      peerDependencies: { valibot: '^1.5.0' },
    }),
  });
  return new DmgCoreCli(await PackageSource.load(pkgRoot));
}

/** Файлы проекта без `node_modules` */
async function snapshot(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const path of new Bun.Glob('**/*').scan({
    cwd: root,
    dot: true,
  })) {
    if (path.startsWith('node_modules/')) continue;
    files.set(path, await read(path));
  }
  return files;
}

/** Пути доставленных копий Claude Code */
async function delivered(): Promise<string[]> {
  return [...(await snapshot()).keys()]
    .filter((path) => path.startsWith('.claude/'))
    .sort();
}

/** Фикстура-поставщик подключена и доставлена */
async function syncExample() {
  await linkExampleProvider(root);
  await config({ providers: ['example-provider'] });
  await (await cli()).sync(root);
}

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'dmg-core-providers-'));
  pkgRoot = join(work, 'pkg');
  root = join(work, 'project');
  await mkdir(root);
});

afterEach(() => rm(work, { recursive: true, force: true }));

describe('sync и check: поставщик example-provider', () => {
  test('скил и роль поставщика доставлены с его меткой', async () => {
    await linkExampleProvider(root);
    await config({ providers: ['example-provider'] });

    expect(await (await cli()).sync(root)).toEqual(OK);

    const meta = { name: 'example-provider', version: '0.1.0' };
    expect(
      Marker.of(await read('.claude/skills/example-skill/SKILL.md')),
    ).toMatchObject(meta);
    const author = await read('.claude/agents/example-author.md');
    expect(Marker.of(author)).toMatchObject(meta);
    expect(author).toContain('tools: Read, Grep, Bash\n');
    expect(author).toEndWith('Общий блок пакета.\n');
  });

  test('копии dmg-core — со своей меткой, check после sync зелёный', async () => {
    await syncExample();

    const meta = { name: 'dmg-core', version: '1.0.0' };
    expect(Marker.of(await read('.claude/skills/demo/SKILL.md'))).toMatchObject(
      meta,
    );
    expect(Marker.of(await read('.claude/agents/alpha.md'))).toMatchObject(
      meta,
    );
    expect(await (await cli()).check(root)).toEqual(OK);
  });

  test('вставка в инструкции — только dmg-core', async () => {
    await syncExample();

    const text = await read('AGENTS.md');
    expect(text).toContain('node_modules/dmg-core/llms.txt');
    expect(text).not.toContain('example-provider');
  });

  describe('цель neutral', () => {
    beforeEach(async () => {
      await linkExampleProvider(root);
      await config({
        providers: ['example-provider'],
        skills: { dirs: ['.pi/skills'] },
        roles: {
          targets: [
            { dir: 'roles', format: 'neutral', common: 'dmg-core-common.md' },
          ],
        },
        instructions: null,
      });
      expect(await (await cli()).sync(root)).toEqual(OK);
    });

    test('исходник роли поставщика — с его меткой', async () => {
      const copy = await read('roles/example-author.md');
      const source = await readFile(
        join(EXAMPLE_PROVIDER, 'agents/roles/example-author.md'),
        'utf8',
      );
      expect(Marker.strip(copy)).toBe(source);
      expect(Marker.of(copy)?.name).toBe('example-provider');
    });

    test('общий блок — только dmg-core', async () => {
      const common = await read('dmg-core-common.md');
      expect(Marker.strip(common)).toBe('Общий блок пакета.\n');
      expect(Marker.of(common)?.name).toBe('dmg-core');
    });
  });

  test('фильтры names общие: доставлены только названные скилы и роли', async () => {
    await linkExampleProvider(root);
    await config({
      providers: ['example-provider'],
      roles: { names: ['alpha', 'example-author'] },
      skills: { names: ['example-skill'] },
    });

    expect(await (await cli()).sync(root)).toEqual(OK);

    expect(await delivered()).toEqual([
      '.claude/agents/alpha.md',
      '.claude/agents/example-author.md',
      '.claude/skills/example-skill/SKILL.md',
    ]);
  });

  test('фильтр names с ролью, которой нет ни у кого, — прежний текст отказа', async () => {
    await linkExampleProvider(root);
    await config({ providers: ['example-provider'], roles: { names: ['x'] } });

    expect(await (await cli()).sync(root)).toEqual({
      ok: false,
      messages: ['.dmg/config.json: нет роли «x» в пакете'],
    });
  });

  test('поставщик убран из providers: check — копия без источника, sync удаляет, копии dmg-core на месте', async () => {
    await syncExample();
    await config({});

    expect(await (await cli()).check(root)).toEqual({
      ok: false,
      messages: [
        'копия без источника: .claude/agents/example-author.md',
        'копия без источника: .claude/skills/example-skill',
      ],
    });
    expect(await (await cli()).sync(root)).toEqual(OK);

    expect(await delivered()).toEqual([
      '.claude/agents/alpha.md',
      '.claude/agents/beta.md',
      '.claude/skills/demo/SKILL.md',
    ]);
    expect(await (await cli()).check(root)).toEqual(OK);
  });

  test('роль сменила владельца: устарела с именами пакетов в обеих метках', async () => {
    await syncExample();
    await config({});
    const next = await cli('1.0.0', {
      'agents/roles/example-author.md': role('example-author'),
    });

    expect(await next.check(root)).toEqual({
      ok: false,
      messages: [
        'устарела (example-provider@0.1.0 → dmg-core@1.0.0): .claude/agents/example-author.md',
        'копия без источника: .claude/skills/example-skill',
      ],
    });
    expect(await next.sync(root)).toEqual(OK);
    expect(
      Marker.of(await read('.claude/agents/example-author.md')),
    ).toMatchObject({ name: 'dmg-core', version: '1.0.0' });
  });
});

describe('sync и check: временный поставщик, версия выросла', () => {
  const files = {
    ...skill('acme-skill'),
    'agents/roles/acme-role.md': role('acme-role'),
  };

  beforeEach(async () => {
    await install('acme-kit', files, '0.1.0');
    await config({ providers: ['acme-kit'] });
    expect(await (await cli()).sync(root)).toEqual(OK);
    await install('acme-kit', files, '0.2.0');
  });

  test('check: устарела (0.1.0 → 0.2.0)', async () => {
    expect(await (await cli()).check(root)).toEqual({
      ok: false,
      messages: [
        'устарела (0.1.0 → 0.2.0): .claude/agents/acme-role.md',
        'устарела (0.1.0 → 0.2.0): .claude/skills/acme-skill/SKILL.md',
      ],
    });
  });

  test('sync обновляет копии, check после него зелёный', async () => {
    expect(await (await cli()).sync(root)).toEqual(OK);

    expect(Marker.of(await read('.claude/agents/acme-role.md'))).toMatchObject({
      name: 'acme-kit',
      version: '0.2.0',
    });
    expect(await (await cli()).check(root)).toEqual(OK);
  });
});

describe('sync и check: отказы поставки, ничего не записано', () => {
  test('роль поставщика совпала с ролью dmg-core — отказ с обоими владельцами', async () => {
    await linkExampleProvider(root);
    await config({ providers: ['example-provider'] });
    const broken = await cli('1.0.0', {
      'agents/roles/example-author.md': role('example-author'),
    });
    const before = await snapshot();
    const expected = {
      ok: false,
      messages: [
        `${PROVIDERS} — роль «example-author» есть у dmg-core и example-provider`,
      ],
    };

    expect(await broken.sync(root)).toEqual(expected);
    expect(await broken.check(root)).toEqual(expected);
    expect(await snapshot()).toEqual(before);
  });

  test('конфликт между поставщиками — оба имени в порядке providers', async () => {
    await install('kit-a', skill('shared'));
    await install('kit-b', skill('shared'));
    await config({ providers: ['kit-a', 'kit-b'] });
    const before = await snapshot();
    const expected = {
      ok: false,
      messages: [`${PROVIDERS} — скил «shared» есть у kit-a и kit-b`],
    };

    expect(await (await cli()).sync(root)).toEqual(expected);
    expect(await (await cli()).check(root)).toEqual(expected);
    expect(await snapshot()).toEqual(before);

    await config({ providers: ['kit-b', 'kit-a'] });
    expect((await (await cli()).sync(root)).messages).toEqual([
      `${PROVIDERS} — скил «shared» есть у kit-b и kit-a`,
    ]);
  });

  test('поставщик не установлен: sync, check и gen — отказ «не найден»', async () => {
    await config({ providers: ['ghost'] });
    const before = await snapshot();
    const expected = { ok: false, messages: [notFound('ghost')] };

    expect(await (await cli()).sync(root)).toEqual(expected);
    expect(await (await cli()).check(root)).toEqual(expected);
    expect(
      await (await cli()).gen(root, ['module', 'todo', '--write']),
    ).toEqual(expected);
    expect(await snapshot()).toEqual(before);
  });
});
