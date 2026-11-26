import { describe, expect, test } from 'bun:test';
import { useTempDir } from '#core/testing/index';
import { put } from '../cli.test-kit';
import { DocSources } from './doc-sources';
import { DocsSettings } from './docs-settings';

const temp = useTempDir('dmg-core-doc-sources-');

const read = async (generated?: string[]) =>
  new DocSources(
    temp().path,
    DocsSettings.of(generated ? { generated } : undefined),
  ).read();

const paths = (files: readonly { path: string }[]) => files.map((f) => f.path);

describe('какие файлы берутся', () => {
  test('*.ts от корня по алфавиту пути, с текстом файла', async () => {
    await put(temp().path, {
      'src/b.ts': '// b\n',
      'src/a.ts': '// a\n',
      'tools/c.ts': '// c\n',
      'root.ts': '// root\n',
    });
    expect(await read()).toEqual([
      { path: 'root.ts', text: '// root\n' },
      { path: 'src/a.ts', text: '// a\n' },
      { path: 'src/b.ts', text: '// b\n' },
      { path: 'tools/c.ts', text: '// c\n' },
    ]);
  });

  test('не .ts не берётся: .md, .js, .json', async () => {
    await put(temp().path, {
      'src/a.ts': '',
      'docs/a.md': '',
      'src/b.js': '',
      'package.json': '{}',
    });
    expect(paths(await read())).toEqual(['src/a.ts']);
  });

  test.each(['x.test.ts', 'x.fixture.ts', 'x.test-kit.ts'])(
    'тестовый код %s (D-70) не берётся',
    async (name) => {
      await put(temp().path, { 'src/a.ts': '', [`src/${name}`]: '' });
      expect(paths(await read())).toEqual(['src/a.ts']);
    },
  );

  test('генерируемое не берётся: файл и каталог с «/»', async () => {
    await put(temp().path, {
      'src/a.ts': '',
      'src/gen.ts': '',
      'src/generated/b.ts': '',
    });
    expect(paths(await read(['src/gen.ts', 'src/generated/']))).toEqual([
      'src/a.ts',
    ]);
  });

  test('каталоги пропуска — у SourceWalk: node_modules не берётся', async () => {
    await put(temp().path, { 'src/a.ts': '', 'node_modules/x/index.ts': '' });
    expect(paths(await read())).toEqual(['src/a.ts']);
  });
});
