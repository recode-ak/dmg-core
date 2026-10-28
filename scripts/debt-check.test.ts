import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { checkDebt, readDebt } from './debt-check';

const md = (...ids: string[]) =>
  ids.map((id) => `### ${id}: заголовок\n- **Место:** …\n`).join('\n');

describe('checkDebt: маркеры в коде и записи в debt.md', () => {
  it('маркер и запись совпадают — без нарушений', () => {
    const code = [{ path: 'src/a.ts', text: '// DEBT-1: причина' }];
    expect(checkDebt(code, md('DEBT-1'))).toEqual([]);
  });

  it('маркер без записи — нарушение с путём', () => {
    const code = [{ path: 'src/a.ts', text: '// DEBT-2: причина' }];
    expect(checkDebt(code, md())).toEqual([
      'DEBT: DEBT-2 есть в коде (src/a.ts), но нет записи в debt.md',
    ]);
  });

  it('запись без маркера — нарушение', () => {
    expect(checkDebt([], md('DEBT-3'))).toEqual([
      'DEBT: DEBT-3 есть в debt.md, но нет маркера в коде',
    ]);
  });
});

describe('readDebt: долг самого пакета', () => {
  it('в пакете нарушений нет', () => {
    const { code, debtMd } = readDebt(join(import.meta.dir, '..'));
    expect(checkDebt(code, debtMd)).toEqual([]);
  });
});
