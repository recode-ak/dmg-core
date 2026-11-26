import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put } from './cli.test-kit';
import { RoleRefs } from './role-refs';

// Ссылки ролей на знания проекта: текст блока и живость файлов.

const refs = (entries: Record<string, string[]>) =>
  new RoleRefs(new Map(Object.entries(entries)));

describe('RoleRefs.block', () => {
  test('два пути — заголовок, пояснение и строка на путь в порядке конфига', () => {
    expect(
      refs({ alpha: ['docs/ux.md', 'docs/domain/index.md'] }).block('alpha'),
    ).toBe(
      [
        '## Знания проекта',
        '',
        'Пути — от корня проекта; прочитай до начала работы:',
        '',
        '- `docs/ux.md`',
        '- `docs/domain/index.md`',
      ].join('\n'),
    );
  });

  test('роль без ссылок — пустая строка', () => {
    expect(refs({ alpha: ['docs/ux.md'] }).block('beta')).toBe('');
  });

  test('без refs вовсе — пустая строка', () => {
    expect(new RoleRefs().block('alpha')).toBe('');
  });

  test('блок каждой роли — только её пути', () => {
    const both = refs({ alpha: ['a.md'], beta: ['b.md'] });
    expect(both.block('alpha')).toContain('- `a.md`');
    expect(both.block('alpha')).not.toContain('b.md');
    expect(both.block('beta')).toContain('- `b.md`');
  });
});

describe('RoleRefs.broken', () => {
  let work: string;
  let root: string;
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), 'role-refs-'));
    root = join(work, 'project');
    await put(root, {
      'docs/ux.md': 'Лист.\n',
      'docs/domain/index.md': 'Оглавление.\n',
    });
  });
  afterEach(() => rm(work, { recursive: true, force: true }));

  const found = (role: string, path: string, problem: string) => ({
    path,
    message: `битая ссылка roles.refs «${role}» (DOC-10) — ${problem}`,
  });
  const MISSING = 'нет файла; создай его или убери путь из .dmg/config.json';
  const DIRECTORY = 'каталог; укажи файл в нём (index.md)';
  const OUTSIDE = 'ведёт за корень проекта; укажи файл внутри проекта';

  test('файлы есть — нарушений нет', async () => {
    const result = await refs({
      alpha: ['docs/ux.md', 'docs/domain/index.md'],
    }).broken(root);
    expect(result).toEqual([]);
  });

  test('без refs — нарушений нет', async () => {
    expect(await new RoleRefs().broken(root)).toEqual([]);
  });

  test('нет файла', async () => {
    expect(await refs({ alpha: ['docs/gone.md'] }).broken(root)).toEqual([
      found('alpha', 'docs/gone.md', MISSING),
    ]);
  });

  test('каталог вместо файла', async () => {
    expect(await refs({ alpha: ['docs/domain'] }).broken(root)).toEqual([
      found('alpha', 'docs/domain', DIRECTORY),
    ]);
  });

  test('висячий симлинк — нет файла', async () => {
    await symlink('nowhere.md', join(root, 'dangling.md'));
    expect(await refs({ alpha: ['dangling.md'] }).broken(root)).toEqual([
      found('alpha', 'dangling.md', MISSING),
    ]);
  });

  test('симлинк за корень — ведёт за корень проекта', async () => {
    await put(work, { 'outside.md': 'Чужой.\n' });
    await symlink(join(work, 'outside.md'), join(root, 'docs/out.md'));
    expect(await refs({ alpha: ['docs/out.md'] }).broken(root)).toEqual([
      found('alpha', 'docs/out.md', OUTSIDE),
    ]);
  });

  test('симлинк внутри корня — допустим', async () => {
    await symlink('ux.md', join(root, 'docs/link.md'));
    await mkdir(join(root, 'linked'));
    await symlink(join(root, 'docs'), join(root, 'linked/docs'));
    expect(
      await refs({ alpha: ['docs/link.md', 'linked/docs/ux.md'] }).broken(root),
    ).toEqual([]);
  });

  test('один путь у двух ролей — два нарушения, в порядке ролей', async () => {
    expect(
      await refs({ alpha: ['docs/gone.md'], beta: ['docs/gone.md'] }).broken(
        root,
      ),
    ).toEqual([
      found('alpha', 'docs/gone.md', MISSING),
      found('beta', 'docs/gone.md', MISSING),
    ]);
  });

  test('рядом с целыми ссылками — только битые, в порядке конфига', async () => {
    expect(
      await refs({
        alpha: ['docs/ux.md', 'docs/gone.md', 'docs/domain'],
      }).broken(root),
    ).toEqual([
      found('alpha', 'docs/gone.md', MISSING),
      found('alpha', 'docs/domain', DIRECTORY),
    ]);
  });
});
