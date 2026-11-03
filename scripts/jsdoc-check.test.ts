import { describe, expect, it } from 'bun:test';
import type { DocFile } from './docs-check';
import { longJsdoc } from './jsdoc-check';

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
