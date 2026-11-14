import { describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { TempDir, useTempDir } from '#core/testing/index';

describe('TempDir', () => {
  test('create — новый каталог во временном каталоге ОС с префиксом', () => {
    const dir = TempDir.create('temp-dir-');
    try {
      expect(statSync(dir.path).isDirectory()).toBe(true);
      expect(dir.path.startsWith(tmpdir())).toBe(true);
      expect(basename(dir.path).startsWith('temp-dir-')).toBe(true);
    } finally {
      dir.dispose();
    }
  });

  test('два create — разные каталоги', () => {
    const a = TempDir.create();
    const b = TempDir.create();
    try {
      expect(a.path).not.toBe(b.path);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  test('file — путь внутри каталога из сегментов', () => {
    const dir = TempDir.create();
    try {
      expect(dir.file('a', 'b.txt')).toBe(join(dir.path, 'a', 'b.txt'));
    } finally {
      dir.dispose();
    }
  });

  test('dispose — каталог удаляется вместе с содержимым', async () => {
    const dir = TempDir.create();
    await Bun.write(dir.file('a', 'b.txt'), 'x');
    dir.dispose();
    expect(existsSync(dir.path)).toBe(false);
  });

  test('using — каталог удаляется при выходе из блока', () => {
    let path = '';
    {
      using dir = TempDir.create();
      path = dir.path;
      expect(existsSync(path)).toBe(true);
    }
    expect(existsSync(path)).toBe(false);
  });
});

// Сценарии ниже зависят от порядка: проверяют beforeEach/afterEach хелпера.
describe('useTempDir', () => {
  const tmp = useTempDir('use-temp-dir-');
  const seen: string[] = [];

  test('в тесте каталог создан', () => {
    seen.push(tmp().path);
    expect(statSync(tmp().path).isDirectory()).toBe(true);
    expect(basename(tmp().path).startsWith('use-temp-dir-')).toBe(true);
  });

  test('следующий тест — новый каталог, прежний удалён', () => {
    expect(tmp().path).not.toBe(seen[0]);
    expect(existsSync(seen[0] ?? '')).toBe(false);
  });
});
