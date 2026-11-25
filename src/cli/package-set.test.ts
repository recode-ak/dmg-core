import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installProvider,
  linkExampleProvider,
  put,
  role,
  skill,
} from './cli.test-kit';
import { PackageSet } from './package-set';
import { PackageSource } from './package-source';
import { ProviderError, ProviderPackage } from './provider-package';

// Объединение поставки dmg-core и поставщиков: владельцы и конфликты.

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'package-set-'));
});
afterEach(() => rm(work, { recursive: true, force: true }));

/** Поставка `dmg-core` во временном каталоге */
async function core(
  files: Record<string, string> = {},
): Promise<PackageSource> {
  await put(join(work, 'core'), {
    'package.json': JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
    ...skill('demo'),
    'agents/roles/alpha.md': role('alpha'),
    'agents/roles/beta.md': role('beta'),
    ...files,
  });
  return PackageSource.load(join(work, 'core'));
}

/** Временный поставщик: пакет в `node_modules` проекта work */
async function provider(
  name: string,
  files: Record<string, string>,
): Promise<PackageSource> {
  await installProvider(work, name, files);
  return PackageSource.provider(await ProviderPackage.find(name, work));
}

async function fixture(): Promise<PackageSource> {
  await linkExampleProvider(work);
  return PackageSource.provider(
    await ProviderPackage.find('example-provider', work),
  );
}

async function conflict(make: () => PackageSet): Promise<unknown> {
  try {
    make();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('PackageSet', () => {
  test('без поставщиков — имена dmg-core, владелец — dmg-core', async () => {
    const pkg = await core();
    const set = new PackageSet(pkg);

    expect(set.core).toBe(pkg);
    expect(set.skillNames()).toEqual(['demo']);
    expect(set.roleNames()).toEqual(['alpha', 'beta']);
    expect(set.skill('demo')?.owner.name).toBe('dmg-core');
    expect(set.skill('demo')?.files.has('SKILL.md')).toBe(true);
    expect(set.role('alpha')?.owner.name).toBe('dmg-core');
    expect(set.role('alpha')?.role.name).toBe('alpha');
  });

  test('с фикстурой — объединение в порядке «dmg-core, поставщики», владельцы названы', async () => {
    const set = new PackageSet(await core(), [await fixture()]);

    expect(set.skillNames()).toEqual(['demo', 'example-skill']);
    expect(set.roleNames()).toEqual(['alpha', 'beta', 'example-author']);
    expect(set.skill('example-skill')?.owner.name).toBe('example-provider');
    expect(set.role('example-author')?.owner.name).toBe('example-provider');
    expect(set.role('example-author')?.role.name).toBe('example-author');
    expect(set.skill('demo')?.owner.name).toBe('dmg-core');
  });

  test('два поставщика без пересечений — порядок по списку providers', async () => {
    const first = await provider('kit-a', skill('a-skill'));
    const second = await provider('kit-b', {
      'agents/roles/b-role.md': role('b-role'),
    });

    const set = new PackageSet(await core(), [first, second]);

    expect(set.skillNames()).toEqual(['demo', 'a-skill']);
    expect(set.roleNames()).toEqual(['alpha', 'beta', 'b-role']);
    expect(set.skill('a-skill')?.owner.name).toBe('kit-a');
    expect(set.role('b-role')?.owner.name).toBe('kit-b');
  });

  test('скил и роль с одним именем — разные пространства имён, не конфликт', async () => {
    const same = await provider('kit-a', {
      ...skill('alpha'),
      'agents/roles/demo.md': role('demo'),
    });
    const set = new PackageSet(await core(), [same]);
    expect(set.skillNames()).toEqual(['demo', 'alpha']);
    expect(set.roleNames()).toEqual(['alpha', 'beta', 'demo']);
  });

  test('роль поставщика с именем роли dmg-core — отказ с обоими владельцами', async () => {
    const pkg = await core({
      'agents/roles/example-author.md': role('example-author'),
    });
    const example = await fixture();

    const error = await conflict(() => new PackageSet(pkg, [example]));

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      '.dmg/config.json: providers — роль «example-author» есть у dmg-core и example-provider',
    );
  });

  test('скил поставщика с именем скила dmg-core — отказ с обоими владельцами', async () => {
    const pkg = await core(skill('example-skill'));
    const example = await fixture();

    const error = await conflict(() => new PackageSet(pkg, [example]));

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      '.dmg/config.json: providers — скил «example-skill» есть у dmg-core и example-provider',
    );
  });

  test('два поставщика с одним скилом — отказ, имена в порядке providers', async () => {
    const first = await provider('kit-a', skill('shared'));
    const second = await provider('kit-b', skill('shared'));
    const pkg = await core();

    const direct = await conflict(() => new PackageSet(pkg, [first, second]));
    const swapped = await conflict(() => new PackageSet(pkg, [second, first]));

    expect(direct).toBeInstanceOf(ProviderError);
    expect((direct as Error).message).toBe(
      '.dmg/config.json: providers — скил «shared» есть у kit-a и kit-b',
    );
    expect((swapped as Error).message).toBe(
      '.dmg/config.json: providers — скил «shared» есть у kit-b и kit-a',
    );
  });
});
