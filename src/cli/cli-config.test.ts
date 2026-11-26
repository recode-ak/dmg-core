import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectConfig, ProjectConfigError } from '../gen/project-config';
import { linkExampleProvider, put, role } from './cli.test-kit';
import { CliConfig } from './cli-config';
import type { CliSettings } from './cli-config.types';
import { PackageSet } from './package-set';
import { PackageSource } from './package-source';
import { ProviderPackage } from './provider-package';

// Настройки доставки по конфигу: правила `roles.refs` — роль из поставки и доставляется.

const PREFIX = '.dmg/config.json: ';

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'cli-config-'));
});
afterEach(() => rm(work, { recursive: true, force: true }));

/** `CliConfig` над `dmg-core` с ролями alpha, beta и поставщиком example-provider */
async function settings(json: unknown): Promise<CliSettings> {
  await put(join(work, 'core'), {
    'package.json': JSON.stringify({ name: 'dmg-core', version: '1.0.0' }),
    'agents/roles/alpha.md': role('alpha'),
    'agents/roles/beta.md': role('beta'),
  });
  // Поставщик ставится до первого поиска: промах Bun.resolveSync кэшируется.
  await linkExampleProvider(work);
  const provider = await PackageSource.provider(
    await ProviderPackage.find('example-provider', work),
  );
  const packages = new PackageSet(
    await PackageSource.load(join(work, 'core')),
    [provider],
  );
  return new CliConfig(packages).parse(ProjectConfig.parse(json));
}

async function refusal(json: unknown): Promise<string> {
  try {
    await settings(json);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectConfigError);
    return (error as Error).message;
  }
  throw new Error('ожидался отказ');
}

describe('CliConfig.parse: roles.refs', () => {
  test('роли dmg-core и поставщика приняты, Map в порядке конфига', async () => {
    const parsed = await settings({
      roles: {
        refs: { 'example-author': ['docs/b.md'], alpha: ['docs/a.md'] },
      },
    });
    expect(parsed.roles.refs).toEqual(
      new Map([
        ['example-author', ['docs/b.md']],
        ['alpha', ['docs/a.md']],
      ]),
    );
  });

  test('нет refs в конфиге — поля в настройках нет', async () => {
    expect((await settings({})).roles.refs).toBe(undefined);
  });

  test('refs: {} — пустая Map', async () => {
    expect((await settings({ roles: { refs: {} } })).roles.refs?.size).toBe(0);
  });

  test.each(['gamma', '__proto__'])(
    'роли «%s» нет в поставке — отказ',
    async (name) => {
      const json = JSON.parse(
        `{"roles":{"refs":{${JSON.stringify(name)}:["a.md"]}}}`,
      );
      expect(await refusal(json)).toBe(
        `${PREFIX}roles.refs — нет роли «${name}» в поставке (ссылки — только у ролей пакетов)`,
      );
    },
  );

  test('роль есть, но вне roles.names — отказ: не доставляется', async () => {
    expect(
      await refusal({ roles: { names: ['alpha'], refs: { beta: ['a.md'] } } }),
    ).toBe(
      `${PREFIX}roles.refs — роль «beta» не доставляется: добавь в roles.names или убери ссылки`,
    );
  });

  test('роль в roles.names — принята', async () => {
    const parsed = await settings({
      roles: { names: ['beta'], refs: { beta: ['a.md'] } },
    });
    expect(parsed.roles.refs?.get('beta')).toEqual(['a.md']);
  });
});
