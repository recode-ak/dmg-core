import { describe, expect, test } from 'bun:test';
import { useTempDir } from '#core/testing/index';
import type { DocsSection } from '../../gen/project-config.types';
import { put } from '../cli.test-kit';
import { DocsChecker } from './docs-checker';
import { DocsSettings } from './docs-settings';
import { DocsTree } from './docs-tree';

const temp = useTempDir('dmg-core-docs-tree-');

const read = (section?: DocsSection) =>
  new DocsTree(temp().path, DocsSettings.of(section)).read();

const paths = (docs: readonly { path: string }[]) => docs.map((d) => d.path);

describe('обход', () => {
  test('от входа в ширину: сначала ссылки входа, затем ссылки листов', async () => {
    await put(temp().path, {
      'llms.txt': '- [A](docs/a.md): когда\n- [C](docs/c.md): когда\n',
      'docs/a.md': '[B](./b.md)\n',
      'docs/b.md': '# Б\n',
      'docs/c.md': '# С\n',
    });
    const { docs, missingEntries } = await read();
    expect(paths(docs)).toEqual([
      'llms.txt',
      'docs/a.md',
      'docs/c.md',
      'docs/b.md',
    ]);
    expect(missingEntries).toEqual([]);
  });

  test('недостижимый лист сверх бюджета в отчёт не попадает', async () => {
    await put(temp().path, {
      'llms.txt': '- [A](docs/a.md): когда\n',
      'docs/a.md': '# А\n',
      'docs/orphan.md': `${'строка\n'.repeat(400)}`,
    });
    const settings = DocsSettings.of();
    const tree = await new DocsTree(temp().path, settings).read();
    expect(new DocsChecker(settings).check(tree)).toEqual([]);
  });

  test('цикл ссылок: каждый документ один раз, обход завершается', async () => {
    await put(temp().path, {
      'llms.txt': '- [A](docs/a.md): когда\n',
      'docs/a.md': '[B](./b.md) [Вход](../llms.txt)\n',
      'docs/b.md': '[A](./a.md) [Сам](./b.md)\n',
    });
    const { docs } = await read();
    expect(paths(docs)).toEqual(['llms.txt', 'docs/a.md', 'docs/b.md']);
  });

  test('ссылка с якорем и повторные ссылки читают файл один раз', async () => {
    await put(temp().path, {
      'llms.txt': '[A](docs/a.md#x) [A](docs/a.md#y) [A](docs/a.md)\n',
      'docs/a.md': '## X\n',
    });
    const { docs } = await read();
    expect(paths(docs)).toEqual(['llms.txt', 'docs/a.md']);
  });

  test('цели не .md не обходятся: .ts, .txt и каталог только существуют', async () => {
    await put(temp().path, {
      'llms.txt': '[код](src/x.ts) [текст](notes.txt) [каталог](src)\n',
      'src/x.ts': '// [скрытая](./hidden.md)\n',
      'notes.txt': '[скрытая](./hidden.md)\n',
      'hidden.md': '# Скрытый\n',
    });
    const { docs, targets, exists } = await read();
    expect(paths(docs)).toEqual(['llms.txt']);
    expect(targets.size).toBe(0);
    expect(exists('src/x.ts')).toBe(true);
    expect(exists('notes.txt')).toBe(true);
    expect(exists('src')).toBe(true);
  });

  test('нет цели — не в обходе, exists ложь', async () => {
    await put(temp().path, {
      'llms.txt': '[A](docs/нет.md) [B](src/нет.ts)\n',
    });
    const { docs, exists } = await read();
    expect(paths(docs)).toEqual(['llms.txt']);
    expect(exists('docs/нет.md')).toBe(false);
    expect(exists('src/нет.ts')).toBe(false);
  });

  test('цель вне корня не читается и не обходится', async () => {
    await put(temp().path, {
      'проект/llms.txt': '[A](../снаружи.md)\n',
      'снаружи.md': '# Снаружи\n',
    });
    const tree = new DocsTree(`${temp().path}/проект`, DocsSettings.of());
    const { docs, targets } = await tree.read();
    expect(paths(docs)).toEqual(['llms.txt']);
    expect(targets.size).toBe(0);
  });
});

describe('входы', () => {
  test('вход не найден — в missingEntries, обход пуст', async () => {
    const { docs, missingEntries } = await read();
    expect(docs).toEqual([]);
    expect(missingEntries).toEqual(['llms.txt']);
  });

  test('несколько входов: найденные обходятся, потерянные названы', async () => {
    await put(temp().path, {
      'start.md': '[A](docs/a.md)\n',
      'docs/a.md': '# А\n',
    });
    const { docs, missingEntries } = await read({
      entries: ['start.md', 'нет.md'],
    });
    expect(paths(docs)).toEqual(['start.md', 'docs/a.md']);
    expect(missingEntries).toEqual(['нет.md']);
  });

  test('свой вход заменяет llms.txt', async () => {
    await put(temp().path, {
      'llms.txt': '[A](a.md)\n',
      'a.md': '# А\n',
      'start.md': '# С\n',
    });
    const { docs, missingEntries } = await read({ entries: ['start.md'] });
    expect(paths(docs)).toEqual(['start.md']);
    expect(missingEntries).toEqual([]);
  });
});

describe('вне обхода: node_modules и генерируемое', () => {
  test('цель в node_modules читается ради якорей и не обходится', async () => {
    await put(temp().path, {
      'llms.txt': '[Пакет](node_modules/pkg/docs/z.md#раздел)\n',
      'node_modules/pkg/docs/z.md': '## Раздел\n[Дальше](./y.md)\n',
      'node_modules/pkg/docs/y.md': '# Дальше\n',
    });
    const { docs, targets, exists } = await read();
    expect(paths(docs)).toEqual(['llms.txt']);
    expect([...targets.keys()]).toEqual(['node_modules/pkg/docs/z.md']);
    expect(
      targets.get('node_modules/pkg/docs/z.md')?.anchors().has('раздел'),
    ).toBe(true);
    expect(exists('node_modules/pkg/docs/z.md')).toBe(true);
  });

  test('генерируемое (файл и каталог) читается ради якорей, не обходится', async () => {
    await put(temp().path, {
      'llms.txt': '[Файл](docs/state.md#а) [Каталог](docs/gen/g.md#б)\n',
      'docs/state.md': '## А\n[Дальше](./late.md)\n',
      'docs/gen/g.md': '## Б\n[Дальше](./late.md)\n',
      'docs/late.md': '# Поздний\n',
    });
    const { docs, targets } = await read({
      generated: ['docs/state.md', 'docs/gen/'],
    });
    expect(paths(docs)).toEqual(['llms.txt']);
    expect([...targets.keys()].sort()).toEqual([
      'docs/gen/g.md',
      'docs/state.md',
    ]);
  });
});

describe('exempt', () => {
  test('исключённый файл обходится: он в дереве и ведёт дальше', async () => {
    await put(temp().path, {
      'llms.txt': '[Большой](docs/big.md)\n',
      'docs/big.md': '[A](./a.md)\n',
      'docs/a.md': '# А\n',
    });
    const { docs } = await read({
      exempt: [{ path: 'docs/big.md', reason: 'не режется' }],
    });
    expect(paths(docs)).toEqual(['llms.txt', 'docs/big.md', 'docs/a.md']);
  });

  test('exists отвечает и по путям исключений: файл есть, файла нет', async () => {
    await put(temp().path, {
      'llms.txt': '# Демо\n',
      'docs/lonely.md': '# Одинокий\n',
    });
    const { exists } = await read({
      exempt: [
        { path: 'docs/lonely.md', reason: 'не режется' },
        { path: 'docs/gone.md', reason: 'не режется' },
      ],
    });
    expect(exists('docs/lonely.md')).toBe(true);
    expect(exists('docs/gone.md')).toBe(false);
  });

  test('exists пути с «/» на конце — только каталог', async () => {
    await put(temp().path, {
      'llms.txt': '# Демо\n',
      'docs/wide/a.md': '# А\n',
    });
    const { exists } = await read();
    expect(exists('docs/wide/')).toBe(true);
    expect(exists('docs/wide/a.md/')).toBe(false);
  });

  test('исключение на каталог без «/» на конце — DOC-05, с «/» — чисто', async () => {
    await put(temp().path, {
      'llms.txt': '- [Широкий](docs/wide/a.md): когда\n',
      'docs/wide/a.md': `${'строка\n'.repeat(400)}`,
    });
    const check = async (path: string) => {
      const settings = DocsSettings.of({
        exempt: [{ path, reason: 'формат' }],
      });
      return new DocsChecker(settings).check(
        await new DocsTree(temp().path, settings).read(),
      );
    };
    const found = (await check('docs/wide')).filter((v) => v.rule === 'DOC-05');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toStartWith('docs/wide — ');
    expect(found[0]?.message).toContain('/ на конце');
    expect(await check('docs/wide/')).toEqual([]);
  });
});
