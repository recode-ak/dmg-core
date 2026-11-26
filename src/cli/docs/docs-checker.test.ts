import { describe, expect, test } from 'bun:test';
import type { DocsSection } from '../../gen/project-config.types';
import type { DocReport } from './doc-report';
import type { DocsTreeRead } from './docs.types';
import { DocsChecker } from './docs-checker';
import { DocsSettings } from './docs-settings';
import { MarkdownDoc } from './markdown-doc';

/** `n` строк текста: ровно `n` для бюджета. */
const lines = (n: number) =>
  `${Array.from({ length: n }, () => 'строка').join('\n')}\n`;

/** Дерево в памяти: документы обхода, прочитанное вне обхода, входы без файла. */
function tree(
  files: Record<string, string>,
  outside: Record<string, string> = {},
  missingEntries: string[] = [],
): DocsTreeRead {
  const docs = Object.entries(files).map(([p, t]) => new MarkdownDoc(p, t));
  const targets = new Map(
    Object.entries(outside).map(([p, t]) => [p, new MarkdownDoc(p, t)]),
  );
  return {
    docs,
    targets,
    exists: (path) => path in files || targets.has(path),
    missingEntries,
  };
}

function check(read: DocsTreeRead, section?: DocsSection) {
  return new DocsChecker(DocsSettings.of(section)).check(read);
}

const rules = (list: { rule: string }[]) => list.map((v) => v.rule);

describe('DOC-01: бюджет вида', () => {
  test.each([
    ['вход', 'llms.txt', 50],
    ['оглавление', 'docs/index.md', 60],
    ['лист', 'docs/a.md', 150],
  ])(
    '%s: ровно бюджет — проходит, на строку больше — DOC-01',
    (_kind, path, limit) => {
      expect(check(tree({ [path]: lines(limit) }))).toEqual([]);
      const [v, ...rest] = check(tree({ [path]: lines(limit + 1) }));
      expect(rest).toEqual([]);
      expect(v?.rule).toBe('DOC-01');
      expect(v?.message).toStartWith(`${path} — `);
      expect(v?.message).toContain(String(limit + 1));
      expect(v?.message).toContain(String(limit));
    },
  );

  test('реестр — без предела', () => {
    const text = `# Реестр\n\n**Серия:** \`D-<n>\`\n${lines(700)}`;
    expect(check(tree({ 'docs/decisions.md': text }))).toEqual([]);
  });

  test('генерируемое — без предела', () => {
    const files = {
      'docs/state/s.md': lines(700),
      'docs/state.md': lines(700),
    };
    expect(
      check(tree(files), { generated: ['docs/state/', 'docs/state.md'] }),
    ).toEqual([]);
  });

  test('limits.leaf: 200 — лист до 200 проходит, 201 нет; прочие бюджеты прежние', () => {
    const section = { limits: { leaf: 200 } };
    expect(check(tree({ 'docs/a.md': lines(200) }), section)).toEqual([]);
    expect(rules(check(tree({ 'docs/a.md': lines(201) }), section))).toEqual([
      'DOC-01',
    ]);
    expect(rules(check(tree({ 'docs/index.md': lines(61) }), section))).toEqual(
      ['DOC-01'],
    );
  });

  test('limits.entry и limits.index заменяют умолчание поштучно', () => {
    const section = { limits: { entry: 10, index: 20 } };
    expect(rules(check(tree({ 'llms.txt': lines(11) }), section))).toEqual([
      'DOC-01',
    ]);
    expect(rules(check(tree({ 'docs/index.md': lines(21) }), section))).toEqual(
      ['DOC-01'],
    );
    expect(check(tree({ 'docs/a.md': lines(150) }), section)).toEqual([]);
  });
});

describe('DOC-02: подпись во входе и оглавлении', () => {
  const leaf = { 'docs/a.md': '# А\n' };

  test('вход .txt: ссылка, «: », подпись — чисто', () => {
    const files = {
      ...leaf,
      'llms.txt': '# Демо\n\n- [Лист](docs/a.md): когда открыть\n',
    };
    expect(check(tree(files))).toEqual([]);
  });

  test('оглавление .md: ссылка, « — », подпись — чисто', () => {
    const files = {
      ...leaf,
      'docs/index.md': '# О\n\n- [Лист](./a.md) — когда открыть\n',
    };
    expect(check(tree(files))).toEqual([]);
  });

  test('нет подписи — DOC-02 с путём и строкой пункта', () => {
    const files = { ...leaf, 'docs/index.md': '# О\n\n- [Лист](./a.md)\n' };
    const [v, ...rest] = check(tree(files));
    expect(rest).toEqual([]);
    expect(v?.rule).toBe('DOC-02');
    expect(v?.message).toStartWith('docs/index.md:3 — ');
  });

  test('нет подписи и во входе', () => {
    const files = { ...leaf, 'llms.txt': '# Демо\n\n- [Лист](docs/a.md)\n' };
    const [v] = check(tree(files));
    expect(v?.rule).toBe('DOC-02');
    expect(v?.message).toStartWith('llms.txt:3 — ');
  });

  test('ровно 120 знаков — чисто, 121 — DOC-02', () => {
    const index = (caption: string) => ({
      ...leaf,
      'docs/index.md': `# О\n\n- [Лист](./a.md) — ${caption}\n`,
    });
    expect(check(tree(index('а'.repeat(120))))).toEqual([]);
    const [v, ...rest] = check(tree(index('а'.repeat(121))));
    expect(rest).toEqual([]);
    expect(v?.rule).toBe('DOC-02');
    expect(v?.message).toStartWith('docs/index.md:3 — ');
    expect(v?.message).toContain('121');
    expect(v?.message).toContain('120');
  });

  test('длина — в кодовых точках, а не в единицах UTF-16', () => {
    const files = {
      ...leaf,
      'docs/index.md': `# О\n\n- [Лист](./a.md) — ${'😀'.repeat(120)}\n`,
    };
    expect(check(tree(files))).toEqual([]);
  });

  test('limits.caption заменяет 120', () => {
    const section = { limits: { caption: 10 } };
    const index = (caption: string) => ({
      ...leaf,
      'docs/index.md': `# О\n\n- [Лист](./a.md) — ${caption}\n`,
    });
    expect(check(tree(index('а'.repeat(10))), section)).toEqual([]);
    expect(rules(check(tree(index('а'.repeat(11))), section))).toEqual([
      'DOC-02',
    ]);
  });

  test('каждый пункт без подписи — своё нарушение', () => {
    const text =
      '# О\n\n- [Лист](./a.md)\n- [Он же](./a.md) — когда\n- [Опять](./a.md)\n';
    const found = check(tree({ ...leaf, 'docs/index.md': text }));
    expect(found.map((v) => v.message.split(' — ')[0])).toEqual([
      'docs/index.md:3',
      'docs/index.md:5',
    ]);
  });

  test('лист, реестр и генерируемое: подписи не проверяются', () => {
    const bare = '# Т\n\n- [Лист](./a.md)\n';
    const files = {
      ...leaf,
      'docs/leaf.md': bare,
      'docs/reg.md': `# Р\n\n**Серия:** \`D-<n>\`\n\n${bare}`,
      'docs/state/g.md': '# Т\n\n- [Лист](../a.md)\n',
    };
    expect(check(tree(files), { generated: ['docs/state/'] })).toEqual([]);
  });
});

describe('DOC-04 в проверке дерева', () => {
  test('битая ссылка и битый якорь листа — DOC-04', () => {
    const files = {
      'docs/a.md': '[x](./нет.md)\n[y](./b.md#нет)\n',
      'docs/b.md': '# Б\n',
    };
    const found = check(tree(files));
    expect(rules(found)).toEqual(['DOC-04', 'DOC-04']);
    expect(found.map((v) => v.message.split(' — ')[0])).toEqual([
      'docs/a.md:1',
      'docs/a.md:2',
    ]);
  });

  test('якорь цели вне обхода сверяется по прочитанному', () => {
    const files = { 'docs/a.md': '[x](../node_modules/p/z.md#нет)\n' };
    const outside = { 'node_modules/p/z.md': '## Есть\n' };
    expect(rules(check(tree(files, outside)))).toEqual(['DOC-04']);
  });
});

describe('exempt (DOC-05)', () => {
  const exempt = (path: string) => ({
    exempt: [{ path, reason: 'не режется без потери смысла' }],
  });

  test('снимает бюджет листа', () => {
    expect(
      check(tree({ 'docs/big.md': lines(400) }), exempt('docs/big.md')),
    ).toEqual([]);
  });

  test('снимает подпись оглавления и бюджет', () => {
    const text = `# О\n\n- [Лист](./a.md)\n${lines(100)}`;
    const files = { 'docs/a.md': '# А\n', 'docs/index.md': text };
    expect(check(tree(files), exempt('docs/index.md'))).toEqual([]);
  });

  test('не снимает битую ссылку и битый якорь', () => {
    const files = { 'docs/big.md': `[x](./нет.md)\n${lines(400)}` };
    expect(rules(check(tree(files), exempt('docs/big.md')))).toEqual([
      'DOC-04',
    ]);
  });

  test('исключение действует только на свой файл', () => {
    const files = { 'docs/big.md': lines(400), 'docs/other.md': lines(400) };
    const found = check(tree(files), exempt('docs/big.md'));
    expect(rules(found)).toEqual(['DOC-01']);
    expect(found[0]?.message).toStartWith('docs/other.md — ');
  });

  test('путь исключения без файла — DOC-05 с этим путём', () => {
    const [v, ...rest] = check(
      tree({ 'docs/a.md': '# А\n' }),
      exempt('docs/gone.md'),
    );
    expect(rest).toEqual([]);
    expect(v?.rule).toBe('DOC-05');
    expect(v?.message).toStartWith('docs/gone.md — ');
  });

  test('исключение с существующим файлом в бюджете — не нарушение', () => {
    expect(check(tree({ 'docs/a.md': '# А\n' }), exempt('docs/a.md'))).toEqual(
      [],
    );
  });
});

describe('DOC-05: вход не найден', () => {
  test('вход без файла — DOC-05 с путём входа', () => {
    const [v, ...rest] = check(tree({}, {}, ['llms.txt']));
    expect(rest).toEqual([]);
    expect(v?.rule).toBe('DOC-05');
    expect(v?.message).toStartWith('llms.txt — ');
  });

  test('каждый недостающий вход — своё нарушение', () => {
    const found = check(tree({}, {}, ['a.md', 'b.md']));
    expect(found.map((v) => v.message.split(' — ')[0])).toEqual([
      'a.md',
      'b.md',
    ]);
    expect(rules(found)).toEqual(['DOC-05', 'DOC-05']);
  });
});

describe('вывод', () => {
  test('отсортирован по пути, затем по номеру строки числом', () => {
    const files = {
      'docs/z.md': lines(151),
      'docs/b.md': `${'\n'.repeat(2)}[x](./1.md)\n${'\n'.repeat(8)}[y](./2.md)\n`,
      'docs/a.md': '[x](./0.md)\n',
    };
    const found = check(tree(files));
    expect(found.map((v) => v.message.split(' — ')[0])).toEqual([
      'docs/a.md:1',
      'docs/b.md:3',
      'docs/b.md:12',
      'docs/z.md',
    ]);
  });

  test('чистое дерево — пусто', () => {
    expect(check(tree({ 'llms.txt': '# Демо\n' }))).toEqual([]);
  });
});

describe('части общего отчёта', () => {
  test('нарушения части входят в отчёт и сортируются вместе с прочими', () => {
    const part = {
      report: (into: DocReport) =>
        into.add('DOC-06', 'docs/a.md', 2, 'часть отчёта'),
    };
    const read = tree({
      'docs/a.md': '[x](./нет.md)\n',
      'docs/b.md': lines(151),
    });
    const found = new DocsChecker(DocsSettings.of()).check(read, [part]);
    expect(rules(found)).toEqual(['DOC-04', 'DOC-06', 'DOC-01']);
    expect(found[1]?.message).toStartWith('docs/a.md:2 — часть отчёта');
  });
});
