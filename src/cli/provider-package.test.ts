import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXAMPLE_PROVIDER,
  installProvider,
  linkExampleProvider,
  put,
} from './cli.test-kit';
import { ProviderError, ProviderPackage } from './provider-package';

// Поиск корня поставщика от корня проекта — через его вход `<имя>/dmg-core`
// без загрузки кода входа; `kinds()` загружает вход. `node_modules` проекта
// собирается до первого поиска: промах `Bun.resolveSync` кэшируется на процесс.

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'provider-package-'));
});
afterEach(() => rm(project, { recursive: true, force: true }));

function manifest(name: string, entry = './dmg-core.ts'): string {
  return JSON.stringify({
    name,
    version: '1.0.0',
    exports: { './dmg-core': entry },
  });
}

async function failure(name: string): Promise<unknown> {
  try {
    await ProviderPackage.find(name, project);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('ProviderPackage.find', () => {
  test('симлинк node_modules/example-provider — корень реальный, вход — dmg-core.ts пакета', async () => {
    await linkExampleProvider(project);

    const found = await ProviderPackage.find('example-provider', project);

    const real = await realpath(EXAMPLE_PROVIDER);
    expect(found.name).toBe('example-provider');
    expect(found.root).toBe(real);
    expect(found.entry).toBe(join(real, 'dmg-core.ts'));
  });

  test('scoped-имя пакета находится', async () => {
    await put(join(project, 'node_modules/@acme/kit'), {
      'package.json': manifest('@acme/kit'),
      'dmg-core.ts': 'export {};\n',
    });

    const found = await ProviderPackage.find('@acme/kit', project);

    expect(found.name).toBe('@acme/kit');
    expect(found.root).toBe(
      await realpath(join(project, 'node_modules/@acme/kit')),
    );
  });

  test('пакета нет — ProviderError «не найден»', async () => {
    const error = await failure('ghost');
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      '.dmg/config.json: providers — пакет «ghost» не найден от корня проекта (нет входа ghost/dmg-core)',
    );
  });

  test('вход во вложенном каталоге со своим package.json другого имени — корень пакет с нужным name', async () => {
    const root = join(project, 'node_modules/acme-kit');
    await put(root, {
      'package.json': manifest('acme-kit', './sub/dmg-core.ts'),
      'sub/package.json': JSON.stringify({ name: 'acme-kit-inner' }),
      'sub/dmg-core.ts': 'export {};\n',
    });

    const found = await ProviderPackage.find('acme-kit', project);

    expect(found.root).toBe(await realpath(root));
    expect(found.entry).toBe(join(await realpath(root), 'sub/dmg-core.ts'));
  });

  test('над входом нет package.json с этим name — ProviderError', async () => {
    await put(join(project, 'node_modules/acme-kit'), {
      'package.json': manifest('other-name'),
      'dmg-core.ts': 'export {};\n',
    });
    const error = await failure('acme-kit');
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Ошибка поставки acme-kit: над входом acme-kit/dmg-core нет package.json с name «acme-kit»',
    );
  });
});

/** Вход поставщика без импорта `dmg-core`: из каталога временного проекта он не резолвится */
const entry = (gen: string) => `export const gen = ${gen};\n`;

async function kindsFailure(name: string): Promise<unknown> {
  try {
    await (await ProviderPackage.find(name, project)).kinds();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('ProviderPackage.kinds', () => {
  test('фикстура example-provider — один вид example-unit с usage «<модуль>»', async () => {
    await linkExampleProvider(project);

    const kinds = await (
      await ProviderPackage.find('example-provider', project)
    ).kinds();

    expect(kinds.map(({ name, usage }) => ({ name, usage }))).toEqual([
      { name: 'example-unit', usage: '<модуль>' },
    ]);
  });

  test('вход без экспорта gen — видов нет', async () => {
    await installProvider(project, 'p');

    expect(await (await ProviderPackage.find('p', project)).kinds()).toEqual(
      [],
    );
  });

  test('вход бросает при импорте — ProviderError с причиной', async () => {
    await installProvider(project, 'p', {
      'dmg-core.ts': "throw new Error('boom');\n",
    });

    const error = await kindsFailure('p');

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Ошибка поставки p: вход p/dmg-core не загружается — boom',
    );
  });

  test('gen не той формы — отказ с требуемой формой', async () => {
    const wrong = [
      '{ kinds: {} }',
      '5',
      "{ kinds: [{ name: 'x', usage: '<m>' }] }",
      "{ kinds: [{ name: 1, usage: '<m>', plan() {} }] }",
      "{ kinds: [{ name: 'x', usage: 2, plan() {} }] }",
    ];
    for (const [index, gen] of wrong.entries()) {
      await installProvider(project, `p${index}`, {
        'dmg-core.ts': entry(gen),
      });
    }

    for (const index of wrong.keys()) {
      const error = await kindsFailure(`p${index}`);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as Error).message).toBe(
        `Ошибка поставки p${index}: вход p${index}/dmg-core — gen: нужен { kinds: [{ name, usage, plan }] }`,
      );
    }
  });

  test('имя вида не в kebab-case — отказ', async () => {
    await installProvider(project, 'p', {
      'dmg-core.ts': entry(
        "{ kinds: [{ name: 'Bad_Kind', usage: '', plan() {} }] }",
      ),
    });

    expect(((await kindsFailure('p')) as Error).message).toBe(
      'Ошибка поставки p: вид «Bad_Kind» — имя в kebab-case (a-z, 0-9, дефисы)',
    );
  });

  test('два вида с одним именем у одного поставщика — отказ', async () => {
    await installProvider(project, 'p', {
      'dmg-core.ts': entry(
        "{ kinds: [{ name: 'x', usage: '', plan() {} }, { name: 'x', usage: '', plan() {} }] }",
      ),
    });

    const error = await kindsFailure('p');

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toBe(
      'Ошибка поставки p: вид «x» объявлен дважды',
    );
  });
});
