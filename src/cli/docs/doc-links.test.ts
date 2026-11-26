import { describe, expect, test } from 'bun:test';
import { DocLinks } from './doc-links';
import { MarkdownDoc } from './markdown-doc';

/**
 * Дерево в памяти: `files` — документы обхода, `outside` — прочитанные `.md`
 * вне обхода (только ради якорей), `other` — существующие не-`.md` цели.
 */
function links(
  files: Record<string, string>,
  other: string[] = [],
  outside: Record<string, string> = {},
) {
  const docs = Object.entries(files).map(([p, t]) => new MarkdownDoc(p, t));
  const known = new Map(
    [
      ...docs,
      ...Object.entries(outside).map(([p, t]) => new MarkdownDoc(p, t)),
    ].map((d) => [d.path, d]),
  );
  const exists = (path: string) => known.has(path) || other.includes(path);
  return new DocLinks(docs, (path) => known.get(path), exists).check();
}

describe('resolve', () => {
  test('путь цели — от каталога файла, нормализованный', () => {
    expect(DocLinks.resolve('docs/a.md', './b.md')).toBe('docs/b.md');
    expect(DocLinks.resolve('docs/a.md', '../README.md')).toBe('README.md');
    expect(DocLinks.resolve('llms.txt', 'docs/a.md')).toBe('docs/a.md');
    expect(DocLinks.resolve('docs/guides/a.md', '../concepts/c.md')).toBe(
      'docs/concepts/c.md',
    );
  });

  test('пустая цель — сам файл', () => {
    expect(DocLinks.resolve('docs/a.md', '')).toBe('docs/a.md');
  });

  test('за корень — путь начинается с «..»', () => {
    expect(DocLinks.resolve('docs/a.md', '../../x.md')).toStartWith('..');
  });
});

describe('check: цель', () => {
  test('все ссылки живые — чисто', () => {
    const violations = links({
      'docs/a.md': '[b](./b.md)\n[c](../c.md)\n',
      'docs/b.md': '# Б\n',
      'c.md': '# С\n',
    });
    expect(violations).toEqual([]);
  });

  test('нет файла — DOC-04 с путём файла, строкой и целью', () => {
    const [v, ...rest] = links({ 'docs/a.md': '# А\n\n[b](./нет.md)\n' });
    expect(rest).toEqual([]);
    expect(v?.rule).toBe('DOC-04');
    expect(v?.message).toStartWith('docs/a.md:3 — ');
    expect(v?.message).toContain('нет.md');
  });

  test('цель не .md существует — чисто, не существует — DOC-04', () => {
    const files = { 'docs/a.md': '[код](../src/x.ts)\n[каталог](../src)\n' };
    expect(links(files, ['src/x.ts', 'src'])).toEqual([]);
    const violations = links(files, ['src']);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain('src/x.ts');
  });

  test('за корень — DOC-04, даже если путь «существует»', () => {
    const violations = links({ 'docs/a.md': '[x](../../x.md)\n' }, ['../x.md']);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('DOC-04');
    expect(violations[0]?.message).toStartWith('docs/a.md:1 — ');
  });

  test('внешняя ссылка не проверяется', () => {
    const text =
      '[a](https://example.com/a.md)\n[b](mailto:a@b.kz)\n[c](HTTP://x.y)\n';
    expect(links({ 'a.md': text })).toEqual([]);
  });

  test('каждая битая ссылка — отдельное нарушение со своей строкой', () => {
    const violations = links({ 'a.md': '[x](1.md)\n\n[y](2.md)\n' });
    expect(violations.map((v) => v.message.split(' — ')[0])).toEqual([
      'a.md:1',
      'a.md:3',
    ]);
  });
});

describe('check: якоря', () => {
  test('якорь своего файла: есть — чисто, нет — DOC-04', () => {
    expect(links({ 'a.md': '## Раздел\n[x](#раздел)\n' })).toEqual([]);
    const violations = links({ 'a.md': '## Раздел\n[x](#нет)\n' });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('DOC-04');
    expect(violations[0]?.message).toStartWith('a.md:2 — ');
    expect(violations[0]?.message).toContain('#нет');
  });

  test('якорь чужого файла: есть — чисто, нет — DOC-04', () => {
    const files = {
      'a.md': '[x](./b.md#часть)\n[y](./b.md#нет)\n',
      'b.md': '## Часть\n',
    };
    const violations = links(files);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toStartWith('a.md:2 — ');
  });

  test('якорь декодируется: %-кодировка кириллицы — живой', () => {
    const encoded = encodeURIComponent('раздел');
    expect(links({ 'a.md': `## Раздел\n[x](#${encoded})\n` })).toEqual([]);
  });

  test('«#» и «файл#» с пустым якорем — не якорь, чисто', () => {
    expect(
      links({ 'a.md': '[x](#)\n[y](./b.md#)\n', 'b.md': '# Б\n' }),
    ).toEqual([]);
  });

  test('«#100%»: не декодируется, берётся как есть — битый якорь, без исключения', () => {
    const violations = links({ 'a.md': '## 100%\n[x](#100%)\n' });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('DOC-04');
  });

  test('цель вне обхода, но прочитанная: якорь сверяется', () => {
    const outside = { 'node_modules/p/docs/z.md': '## Есть\n' };
    const ok = links(
      { 'a.md': '[x](node_modules/p/docs/z.md#есть)\n' },
      [],
      outside,
    );
    expect(ok).toEqual([]);
    const bad = links(
      { 'a.md': '[x](node_modules/p/docs/z.md#нет)\n' },
      [],
      outside,
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]?.message).toStartWith('a.md:1 — ');
  });

  test('цель существует, но не прочитана: якорь не проверяется', () => {
    const docs = [new MarkdownDoc('a.md', '[x](./gen.md#что-угодно)\n')];
    const violations = new DocLinks(
      docs,
      () => undefined,
      (path) => path === 'gen.md',
    ).check();
    expect(violations).toEqual([]);
  });

  test('якорь у цели не .md не проверяется', () => {
    expect(links({ 'a.md': '[x](./src/x.ts#L10)\n' }, ['src/x.ts'])).toEqual(
      [],
    );
  });
});
