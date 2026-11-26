import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { DocIds } from '../src/cli/docs/doc-ids';
import { DocReport } from '../src/cli/docs/doc-report';
import { DocSources } from '../src/cli/docs/doc-sources';
import { DocsLibrary } from '../src/cli/docs/docs-library';
import { DocsSettings } from '../src/cli/docs/docs-settings';
import { DocsTree } from '../src/cli/docs/docs-tree';
import { MarkdownDoc } from '../src/cli/docs/markdown-doc';
import {
  checkDocs,
  checkLinks,
  checkSee,
  type DocFile,
  readDocs,
} from './docs-check';

const ROOT = join(import.meta.dir, '..');

const doc = (text: string, path = 'docs/guides/aggregate.md'): DocFile => ({
  path,
  text,
});

describe('checkDocs: направление ссылок', () => {
  const at = (path: string, ...targets: string[]) =>
    doc(targets.map((t) => `[x](${t})`).join(' '), path);

  it('concepts → guides, reference, decisions, образцы — без нарушений', () => {
    const files = [
      at(
        'docs/concepts/uc-path.md',
        '../guides/use-case.md',
        '../reference/rules.md',
        '../decisions.md',
        './layers.md',
        '../../src/testing/example/platform/domain/todo/task/task.ar.ts',
      ),
    ];
    expect(checkDocs(files)).toEqual([]);
  });

  it('guides → decisions — против направления', () => {
    const files = [at('docs/guides/facade.md', '../decisions.md')];
    expect(checkDocs(files)).toEqual([
      'docs/guides/facade.md: ссылка против направления (guides → decisions) ../decisions.md',
    ]);
  });

  it('reference → concepts и guides — против направления; → reference, decisions — можно', () => {
    const files = [
      at(
        'docs/reference/rules.md',
        './naming.md',
        '../decisions.md',
        '../concepts/uc-path.md',
        '../guides/use-case.md',
      ),
    ];
    expect(checkDocs(files)).toEqual([
      'docs/reference/rules.md: ссылка против направления (reference → concepts) ../concepts/uc-path.md',
      'docs/reference/rules.md: ссылка против направления (reference → guides) ../guides/use-case.md',
    ]);
  });

  it('документ → исходник платформы (не образец) — против направления', () => {
    const files = [
      at('docs/guides/facade.md', '../../src/app/facade/module-facade.ts'),
    ];
    expect(checkDocs(files)).toEqual([
      'docs/guides/facade.md: ссылка против направления (guides → src) ../../src/app/facade/module-facade.ts',
    ]);
  });

  it('смешанные документы в корне docs/, llms.txt, skills — не ограничены', () => {
    const files = [
      at('docs/transport.md', './decisions.md', '../src/app/index.ts'),
      at('llms.txt', 'docs/concepts/uc-path.md', 'src/index.ts'),
      at('skills/dmg-architecture/SKILL.md', '../../docs/decisions.md'),
    ];
    expect(checkDocs(files)).toEqual([]);
  });
});

describe('checkSee: @see в JSDoc', () => {
  const docs = [doc('# Путь UC\n\n## Commit\n', 'docs/concepts/uc-path.md')];
  const src = (text: string): DocFile => ({ path: 'src/app/uow.ts', text });
  const known = new Set(['docs/concepts/uc-path.md', 'src/app/uow.test.ts']);
  const has = (path: string) => known.has(path);

  it('путь от корня пакета на документ, якорь и тест — без нарушений', () => {
    const files = [
      src(
        '/**\n * Фиксирует.\n * @see docs/concepts/uc-path.md#commit\n * @see src/app/uow.test.ts\n */',
      ),
    ];
    expect(checkSee(files, docs, has)).toEqual([]);
  });

  it('@see на символ — не путь, не проверяется', () => {
    expect(checkSee([src('/** @see UnitOfWork */')], docs, has)).toEqual([]);
  });

  it('несуществующий файл и битый якорь — нарушения', () => {
    const files = [
      src(
        '/**\n * @see docs/concepts/uow.md\n * @see docs/concepts/uc-path.md#сбои\n */',
      ),
    ];
    expect(checkSee(files, docs, has)).toEqual([
      'src/app/uow.ts: @see ведёт в несуществующий файл docs/concepts/uow.md',
      'src/app/uow.ts: @see — битый якорь docs/concepts/uc-path.md#сбои',
    ]);
  });

  it('пунктуация после пути — не часть пути', () => {
    const files = [src('/** См. @see docs/concepts/uow.md. */')];
    expect(checkSee(files, docs, has)).toEqual([
      'src/app/uow.ts: @see ведёт в несуществующий файл docs/concepts/uow.md',
    ]);
  });
});

describe('@see в src пакета (контракт)', () => {
  it('пути живые, якоря — на заголовки', () => {
    const { files, sources, exists } = readDocs(ROOT);
    expect(sources.map((f) => f.path)).toContain('src/app/index.ts');
    expect(checkSee(sources, files, exists)).toEqual([]);
  });
});

describe('документация пакета (контракт)', () => {
  it('ссылки живые, внутри пакета, по направлениям D-59', () => {
    const { files, exists } = readDocs(ROOT);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('llms.txt');
    expect(paths).toContain('docs/guides/use-case.md');
    expect(paths).toContain('skills/dmg-architecture/SKILL.md');
    expect(paths).toContain('agents/roles/dmg-reviewer.md');
    expect(checkLinks(files, exists)).toEqual([]);
    expect(checkDocs(files)).toEqual([]);
  });

  it('ID документов и исходников пакета ведут на записи (DOC-07)', async () => {
    const settings = DocsSettings.of();
    const tree = await new DocsTree(ROOT, settings).read();
    const registries = await DocsLibrary.load({
      root: ROOT,
      coreRoot: ROOT,
      providers: [],
      project: tree.docs,
    });
    expect(registries.grammar().find('GR-01 ARC-13 D-114')).toHaveLength(3);
    const docs = readDocs(ROOT).files.map(
      (f) => new MarkdownDoc(f.path, f.text),
    );
    const sources = await new DocSources(ROOT, settings).read();
    const into = new DocReport();
    new DocIds(registries, docs, sources).report(into);
    expect(into.violations().map((v) => v.format())).toEqual([]);
  });
});
