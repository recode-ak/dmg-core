import { describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '#core/testing/index';
import { installProvider, put } from '../cli.test-kit';
import { ProviderError } from '../provider-package';
import { DocReport } from './doc-report';
import { DocsLibrary } from './docs-library';
import { MarkdownDoc } from './markdown-doc';

const project = useTempDir('dmg-core-docs-library-project-');
const core = useTempDir('dmg-core-docs-library-core-');

/** Текст документа из строк, с переводом строки в конце. */
const md = (...lines: string[]) => `${lines.join('\n')}\n`;

/** Реестр серии prefix с записью prefix-1. */
const registry = (prefix: string) =>
  md(
    '# Реестр',
    '',
    `**Серия:** \`${prefix}-<n>\``,
    '',
    `### ${prefix}-1. Запись`,
  );

/** Дерево пакета: вход `llms.txt` ведёт на реестр серии prefix. */
const tree = (prefix: string): Record<string, string> => ({
  'llms.txt': md('# Вход', '', '- [Реестр](docs/reg.md): когда открыть'),
  'docs/reg.md': registry(prefix),
});

/** Документы проекта в памяти: диск проекта не читается. */
const projectDocs = (prefix: string) => [
  new MarkdownDoc('docs/reg.md', registry(prefix)),
];

const load = (prefix: string, providers: string[] = []) =>
  DocsLibrary.load({
    root: project().path,
    coreRoot: core().path,
    providers,
    project: projectDocs(prefix),
  });

const names = (found: { source: { name: string } }[]) =>
  found.map((f) => f.source.name);

describe('источники', () => {
  test('проект — из переданных документов: имя «проект», корень проекта', async () => {
    const found = (await load('PP')).find('PP-1');
    expect(found.map((f) => f.source)).toEqual([
      { name: 'проект', root: project().path, project: true },
    ]);
  });

  test('ядро — от его llms.txt, имя dmg-core, корень ядра', async () => {
    await put(core().path, tree('CC'));
    const found = (await load('PP')).find('CC-1');
    expect(found.map((f) => f.source)).toEqual([
      { name: 'dmg-core', root: core().path, project: false },
    ]);
    expect(found[0]?.record.path).toBe('docs/reg.md');
  });

  test('поставщик — от его llms.txt, имя пакета, корень пакета', async () => {
    await installProvider(project().path, 'prov', tree('VV'));
    const found = (await load('PP', ['prov'])).find('VV-1');
    expect(found.map((f) => f.source)).toEqual([
      {
        name: 'prov',
        root: join(project().path, 'node_modules', 'prov'),
        project: false,
      },
    ]);
  });

  test('порядок: проект, ядро, поставщики по порядку конфига', async () => {
    await put(core().path, tree('XX'));
    await installProvider(project().path, 'zeta', tree('XX'));
    await installProvider(project().path, 'alpha', tree('XX'));
    const library = await load('XX', ['zeta', 'alpha']);
    expect(names(library.find('XX-1'))).toEqual([
      'проект',
      'dmg-core',
      'zeta',
      'alpha',
    ]);
  });
});

describe('что читается у пакета', () => {
  test('реестр вне дерева от llms.txt не читается', async () => {
    await installProvider(project().path, 'prov', {
      ...tree('VV'),
      'docs/orphan.md': registry('QQ'),
    });
    const library = await load('PP', ['prov']);
    expect(library.find('VV-1')).toHaveLength(1);
    expect(library.find('QQ-1')).toEqual([]);
  });

  test('.dmg/config.json поставщика игнорируется: вход — llms.txt', async () => {
    await installProvider(project().path, 'prov', {
      ...tree('VV'),
      '.dmg/config.json': JSON.stringify({ docs: { entries: ['START.md'] } }),
      'START.md': md('# Старт', '', '- [Реестр](docs/other.md) — когда'),
      'docs/other.md': registry('QQ'),
    });
    const library = await load('PP', ['prov']);
    expect(library.find('VV-1')).toHaveLength(1);
    expect(library.find('QQ-1')).toEqual([]);
  });

  test('поставщик без llms.txt — без реестров и без ошибки', async () => {
    await installProvider(project().path, 'prov', {
      'docs/reg.md': registry('VV'),
    });
    const library = await load('PP', ['prov']);
    expect(library.find('VV-1')).toEqual([]);
  });

  test('поставщик не установлен — ProviderError с именем пакета', async () => {
    const failed = load('PP', ['absent-pkg']);
    await expect(failed).rejects.toBeInstanceOf(ProviderError);
    await expect(failed).rejects.toThrow('absent-pkg');
  });
});

describe('повтор корня', () => {
  /** Проект и ядро — один каталог: файлы на диске и те же документы в `project`. */
  async function sameRoot(coreRoot: string) {
    await put(project().path, tree('SS'));
    const library = await DocsLibrary.load({
      root: project().path,
      coreRoot,
      providers: [],
      project: projectDocs('SS'),
    });
    const into = new DocReport();
    library.report(into);
    return { found: library.find('SS-1'), report: into.violations() };
  }

  test('корень ядра совпал с корнем проекта — реестры один раз, без DOC-06', async () => {
    const { found, report } = await sameRoot(project().path);
    expect(names(found)).toEqual(['проект']);
    expect(report).toEqual([]);
  });

  test('корень ядра — симлинк на корень проекта: совпадение по realpath', async () => {
    const link = join(core().path, 'link');
    await symlink(project().path, link);
    const { found, report } = await sameRoot(link);
    expect(names(found)).toEqual(['проект']);
    expect(report).toEqual([]);
  });

  test('поставщик, совпавший с корнем ядра по realpath, — один раз', async () => {
    await put(core().path, {
      ...tree('XX'),
      'package.json': JSON.stringify({
        name: 'prov',
        version: '0.1.0',
        type: 'module',
        exports: { './dmg-core': './dmg-core.ts' },
      }),
      'dmg-core.ts': 'export {};\n',
    });
    await mkdir(join(project().path, 'node_modules'), { recursive: true });
    await symlink(core().path, join(project().path, 'node_modules', 'prov'));
    const library = await load('PP', ['prov']);
    expect(names(library.find('XX-1'))).toEqual(['dmg-core']);
  });
});
