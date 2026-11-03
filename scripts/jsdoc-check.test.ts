import { describe, expect, it } from 'bun:test';
import type { DocFile } from './docs-check';
import { inlineSee, longJsdoc } from './jsdoc-check';

const src = (lines: number, extra = '', path = 'src/app/uow.ts'): DocFile => ({
  path,
  text: [
    'const a = 1;',
    '/**',
    ...Array.from({ length: lines - 2 }, (_, i) => ` * строка ${i}`),
    ...(extra ? [extra] : []),
    ' */',
    'export const b = 2;',
  ].join('\n'),
});

describe('longJsdoc: JSDoc длиннее 6 строк без @see (CODE-04)', () => {
  it('7 строк без @see — предупреждение с файлом, строкой и длиной', () => {
    expect(longJsdoc([src(7)])).toEqual([
      'src/app/uow.ts:2: JSDoc 7 строк без @see (CODE-04)',
    ]);
  });

  it('6 строк — без предупреждения', () => {
    expect(longJsdoc([src(6)])).toEqual([]);
  });

  it('длинный со @see — без предупреждения', () => {
    expect(longJsdoc([src(7, ' * @see docs/concepts/uc-path.md')])).toEqual([]);
  });

  it('обычный блочный комментарий — не JSDoc', () => {
    const text = ['/*', ...Array(8).fill(' * x'), ' */'].join('\n');
    expect(longJsdoc([{ path: 'src/a.ts', text }])).toEqual([]);
  });

  it('тесты не проверяются', () => {
    expect(longJsdoc([src(9, '', 'src/app/uow.test.ts')])).toEqual([]);
  });
});

describe('inlineSee: @see не в начале строки JSDoc (CODE-04)', () => {
  const file = (...lines: string[]): DocFile => ({
    path: 'src/app/uow.ts',
    text: ['const a = 1;', ...lines, 'export const b = 2;'].join('\n'),
  });

  it('@see после текста строки — предупреждение со строкой тега', () => {
    expect(
      inlineSee([
        file('/**', ' * Коротко. @see docs/concepts/uc-path.md', ' */'),
      ]),
    ).toEqual(['src/app/uow.ts:3: @see не в начале строки JSDoc (CODE-04)']);
  });

  it('@see на своей строке — без предупреждения', () => {
    expect(
      inlineSee([
        file('/**', ' * Коротко.', ' * @see docs/concepts/uc-path.md', ' */'),
      ]),
    ).toEqual([]);
  });

  it('@see вне JSDoc и в тестах не проверяется', () => {
    expect(inlineSee([file('// текст @see docs/a.md')])).toEqual([]);
    expect(
      inlineSee([{ path: 'src/a.test.ts', text: '/** x @see docs/a.md */' }]),
    ).toEqual([]);
  });
});
