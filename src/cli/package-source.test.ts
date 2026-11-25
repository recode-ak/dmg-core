import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installProvider,
  linkExampleProvider,
  put,
  role,
} from './cli.test-kit';
import { PackageSource } from './package-source';
import { ProviderError, ProviderPackage } from './provider-package';

// Версии зависимостей пакета — из его package.json: по ним каркас проекта
// (`init --profile`) пишет зависимости потребителя.

const PACKAGE_ROOT = join(import.meta.dir, '../..');

const PACKAGE_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
  'skills/demo/SKILL.md': '---\nname: demo\ndescription: d\n---\n\nСкил.\n',
  'skills/demo/ref/notes.md': 'Заметки.\n',
  'agents/roles/alpha.md': role('alpha'),
  'agents/roles/beta.md': role('beta'),
  'agents/common.md': 'Общий блок пакета.\n',
};

/** Пакет-поставщик в `node_modules` проекта dir (до первого поиска — кэш резолвера Bun) */
async function install(
  name: string,
  files: Record<string, string> = {},
): Promise<ProviderPackage> {
  await installProvider(dir, name, files, '2.0.0');
  return ProviderPackage.find(name, dir);
}

async function rejection(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'package-source-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('PackageSource: версии зависимостей', () => {
  it('peer и dev — как в package.json пакета', async () => {
    const manifest = JSON.parse(
      await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
    );

    const pkg = await PackageSource.load(PACKAGE_ROOT);

    expect(pkg.version).toBe(manifest.version);
    expect(pkg.peerDependencies).toEqual(manifest.peerDependencies);
    expect(pkg.devDependencies).toEqual(manifest.devDependencies);
    expect(pkg.peerDependencies.valibot).toBeString();
    expect(pkg.devDependencies['@biomejs/biome']).toBeString();
  });

  it('moduleDependencies — диапазоны пакета модуля: dmg-core и peer valibot', async () => {
    const pkg = await PackageSource.load(PACKAGE_ROOT);

    expect(pkg.moduleDependencies()).toEqual({
      'dmg-core': `^${pkg.version}`,
      valibot: expect.stringMatching(/^\^/),
    });
    expect(pkg.moduleDependencies().valibot).toBe(
      pkg.peerDependencies.valibot ?? 'нет',
    );
  });

  it('нет секций зависимостей — пустые словари', async () => {
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
    );
    await mkdir(join(dir, 'skills'));
    await mkdir(join(dir, 'agents/roles'), { recursive: true });

    const pkg = await PackageSource.load(dir);

    expect(pkg.peerDependencies).toEqual({});
    expect(pkg.devDependencies).toEqual({});
  });
});

describe('PackageSource: пакет dmg-core', () => {
  it('читает версию, скилы, роли и общий блок пакета', async () => {
    await put(dir, PACKAGE_FILES);
    const pkg = await PackageSource.load(dir);
    expect(pkg.version).toBe('1.0.0');
    expect([...pkg.skills.keys()]).toEqual(['demo']);
    expect([...(pkg.skills.get('demo')?.keys() ?? [])].sort()).toEqual([
      'SKILL.md',
      'ref/notes.md',
    ]);
    expect(pkg.roles.map((r) => r.name)).toEqual(['alpha', 'beta']);
    expect(pkg.common).toBe('Общий блок пакета.\n');
  });

  it('настоящий пакет: роли фреймворка и скил dmg-architecture', async () => {
    const pkg = await PackageSource.load(PACKAGE_ROOT);
    expect(pkg.roles.map((r) => r.name).sort()).toEqual([
      'dmg-api-author',
      'dmg-data-keeper',
      'dmg-domain-author',
      'dmg-reviewer',
      'dmg-tech-lead',
      'dmg-test-designer',
    ]);
    expect([...pkg.skills.keys()]).toEqual(['dmg-architecture']);
  });

  it('имя — dmg-core, даже если в манифесте другое (метка не зависит от name)', async () => {
    await put(dir, {
      'package.json': JSON.stringify({ name: 'other', version: '3.0.0' }),
    });
    const pkg = await PackageSource.load(dir);
    expect(pkg.name).toBe('dmg-core');
    expect(pkg.marker().comment).toContain('dmg-core@3.0.0');
  });

  it('нет каталогов skills/ и agents/roles — пустые скилы и роли', async () => {
    await put(dir, {
      'package.json': JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
    });
    const pkg = await PackageSource.load(dir);
    expect(pkg.skills.size).toBe(0);
    expect(pkg.roles).toEqual([]);
    expect(pkg.common).toBe('');
  });
});

describe('PackageSource.provider: поставщик', () => {
  it('фикстура example-provider: имя, версия, скил, роль, без общего блока', async () => {
    await linkExampleProvider(dir);
    const found = await ProviderPackage.find('example-provider', dir);

    const pkg = await PackageSource.provider(found);

    expect(pkg.name).toBe('example-provider');
    expect(pkg.version).toBe('0.1.0');
    expect([...pkg.skills.keys()]).toEqual(['example-skill']);
    expect([...(pkg.skills.get('example-skill')?.keys() ?? [])]).toEqual([
      'SKILL.md',
    ]);
    expect(pkg.roles.map((r) => r.name)).toEqual(['example-author']);
    expect(pkg.common).toBe('');
    expect(pkg.marker().comment).toContain('example-provider@0.1.0');
  });

  it('зависимости в манифесте поставщика не несутся в каркас', async () => {
    const found = await install('with-deps');
    await put(join(dir, 'node_modules/with-deps'), {
      'package.json': JSON.stringify({
        name: 'with-deps',
        version: '2.0.0',
        exports: { './dmg-core': './dmg-core.ts' },
        peerDependencies: { valibot: '^1.0.0' },
        devDependencies: { x: '^1.0.0' },
      }),
    });
    const pkg = await PackageSource.provider(found);
    expect(pkg.peerDependencies).toEqual({});
    expect(pkg.devDependencies).toEqual({});
  });

  it('agents/common.md у поставщика — ProviderError', async () => {
    const found = await install('acme-kit', {
      'agents/common.md': 'Свой общий блок.\n',
    });
    const error = await rejection(() => PackageSource.provider(found));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Ошибка поставки acme-kit: agents/common.md — общий блок ролей несёт только dmg-core',
    );
  });

  it('битая роль поставщика — ProviderError с путём роли', async () => {
    const found = await install('acme-kit', {
      'agents/roles/bad.md': 'Без frontmatter.\n',
    });
    const error = await rejection(() => PackageSource.provider(found));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Ошибка поставки acme-kit: agents/roles/bad.md: нет frontmatter',
    );
  });

  it('только skills/ или только agents/roles — второго каталога нет и это не ошибка', async () => {
    const onlySkills = await install('only-skills', {
      'skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n\nТело.\n',
    });
    const onlyRoles = await install('only-roles', {
      'agents/roles/r.md': role('r'),
    });
    const a = await PackageSource.provider(onlySkills);
    const b = await PackageSource.provider(onlyRoles);
    expect([...a.skills.keys()]).toEqual(['s']);
    expect(a.roles).toEqual([]);
    expect(b.skills.size).toBe(0);
    expect(b.roles.map((r) => r.name)).toEqual(['r']);
  });

  it.each([
    ['нет version', {}],
    ['version не строка', { version: 2 }],
  ])('package.json поставщика: %s — ProviderError', async (_case, extra) => {
    const found = await install('no-version');
    await put(join(dir, 'node_modules/no-version'), {
      'package.json': JSON.stringify({
        name: 'no-version',
        exports: { './dmg-core': './dmg-core.ts' },
        ...extra,
      }),
    });
    const error = await rejection(() => PackageSource.provider(found));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Ошибка поставки no-version: package.json без version',
    );
  });
});
