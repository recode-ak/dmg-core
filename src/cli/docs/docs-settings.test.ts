import { describe, expect, test } from 'bun:test';
import { DocsSettings } from './docs-settings';

describe('умолчания', () => {
  test('без секции: вход llms.txt, бюджеты 50 / 60 / 150, подпись 120', () => {
    for (const settings of [DocsSettings.of(), DocsSettings.of({})]) {
      expect(settings.entries).toEqual(['llms.txt']);
      expect(settings.limits).toEqual({
        entry: 50,
        index: 60,
        leaf: 150,
        caption: 120,
      });
      expect(settings.exemptPaths).toEqual([]);
    }
    expect(DocsSettings.defaults.entries).toEqual(['llms.txt']);
    expect(DocsSettings.defaults.limits).toEqual({
      entry: 50,
      index: 60,
      leaf: 150,
      caption: 120,
    });
  });

  test('entries заменяют умолчание целиком', () => {
    expect(DocsSettings.of({ entries: ['a.md', 'b.md'] }).entries).toEqual([
      'a.md',
      'b.md',
    ]);
  });

  test('limits заменяют умолчание поштучно', () => {
    const { limits } = DocsSettings.of({ limits: { leaf: 200, caption: 80 } });
    expect(limits).toEqual({ entry: 50, index: 60, leaf: 200, caption: 80 });
  });
});

describe('исключения и генерируемое', () => {
  const settingsOf = () =>
    DocsSettings.of({
      exempt: [
        { path: 'docs/big.md', reason: 'не режется' },
        { path: 'docs/wide/', reason: 'формат документа' },
      ],
      generated: ['docs/state.md', 'docs/state/'],
    });

  test('exemptPaths — пути исключений как заданы', () => {
    const settings = settingsOf();
    expect(settings.exemptPaths).toEqual(['docs/big.md', 'docs/wide/']);
  });

  test('isExempt: файл — точно, каталог с «/» — всё внутри', () => {
    const settings = settingsOf();
    expect(settings.isExempt('docs/big.md')).toBe(true);
    expect(settings.isExempt('docs/wide/a.md')).toBe(true);
    expect(settings.isExempt('docs/wide/deep/b.md')).toBe(true);
    expect(settings.isExempt('docs/other.md')).toBe(false);
    expect(settings.isExempt('docs/big.md.bak')).toBe(false);
    expect(settings.isExempt('docs/wider/a.md')).toBe(false);
  });

  test('isGenerated: файл — точно, каталог с «/» — всё внутри', () => {
    const settings = settingsOf();
    expect(settings.isGenerated('docs/state.md')).toBe(true);
    expect(settings.isGenerated('docs/state/a.md')).toBe(true);
    expect(settings.isGenerated('docs/state/deep/b.md')).toBe(true);
    expect(settings.isGenerated('docs/state-old.md')).toBe(false);
    expect(settings.isGenerated('docs/states/a.md')).toBe(false);
  });

  test('glob не поддерживается: «*» — обычный символ', () => {
    const glob = DocsSettings.of({
      generated: ['docs/*.md'],
      exempt: [{ path: 'docs/*', reason: 'r' }],
    });
    expect(glob.isGenerated('docs/a.md')).toBe(false);
    expect(glob.isExempt('docs/a.md')).toBe(false);
  });

  test('без секции ничего не исключено и не генерируется', () => {
    const none = DocsSettings.of();
    expect(none.isExempt('docs/big.md')).toBe(false);
    expect(none.isGenerated('docs/state/a.md')).toBe(false);
  });
});
