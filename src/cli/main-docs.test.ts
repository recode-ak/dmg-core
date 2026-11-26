import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '#core/testing/index';
import { put } from './cli.test-kit';

const MAIN = join(import.meta.dir, 'main.ts');
const USAGE_DOCS = 'dmg-core docs --check';

const temp = useTempDir('dmg-core-docs-cli-');

/** Процесс `bun main.ts docs …` в корне временного проекта. */
function run(...args: string[]) {
  const proc = Bun.spawnSync(['bun', MAIN, 'docs', ...args], {
    cwd: temp().path,
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

const lines = (n: number) => 'строка\n'.repeat(n);

/** Чистое дерево: вход и один лист. */
const CLEAN = {
  'llms.txt': '# Демо\n\n- [Лист](docs/a.md): когда открыть\n',
  'docs/a.md': '# А\n',
};

/** Отказ без стека: ни строк `    at `, ни имени исключения. */
function expectNoStack(stderr: string): void {
  expect(stderr).not.toMatch(/^\s+at /m);
  expect(stderr).not.toContain('ProjectConfigError');
  expect(stderr).not.toMatch(/^error:/m);
}

describe('dmg-core docs --check: результат', () => {
  test('чистое дерево — код 0, ошибок нет', async () => {
    await put(temp().path, CLEAN);
    const result = run('--check');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('нарушения — код 1, строки «DOC-NN: …» по пути и строке, итог в конце', async () => {
    await put(temp().path, {
      'llms.txt':
        '# Демо\n\n- [Лист](docs/a.md)\n- [Битая](docs/нет.md): когда\n',
      'docs/a.md': '[x](./нет.md)\n',
    });
    const result = run('--check');
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    const rows = result.stderr.trim().split('\n');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toStartWith('DOC-04: docs/a.md:1 — ');
    expect(rows[1]).toStartWith('DOC-02: llms.txt:3 — ');
    expect(rows[2]).toStartWith('DOC-04: llms.txt:4 — ');
    expect(rows[3]).toContain('нарушений — 3');
    expectNoStack(result.stderr);
  });
});

describe('dmg-core docs --check: вход и секция docs', () => {
  test('нет конфига: вход llms.txt; его нет — DOC-05, код 1', async () => {
    await put(temp().path, { 'README.md': '# Демо\n' });
    const result = run('--check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DOC-05: llms.txt — ');
    expectNoStack(result.stderr);
  });

  test('docs.entries: вход из конфига вместо llms.txt', async () => {
    await put(temp().path, {
      '.dmg/config.json': JSON.stringify({ docs: { entries: ['START.md'] } }),
      'START.md': '# Старт\n\n- [Лист](docs/a.md) — когда открыть\n',
      'docs/a.md': '# А\n',
    });
    const result = run('--check');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('docs.limits.leaf: бюджет из конфига', async () => {
    await put(temp().path, {
      ...CLEAN,
      'docs/a.md': lines(6),
      '.dmg/config.json': JSON.stringify({ docs: { limits: { leaf: 5 } } }),
    });
    const result = run('--check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DOC-01: docs/a.md — ');
  });

  test('кривая секция docs — код 1, отказ ProjectConfig без стека', async () => {
    await put(temp().path, {
      ...CLEAN,
      '.dmg/config.json': JSON.stringify({ docs: { entries: 'llms.txt' } }),
    });
    const result = run('--check');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('.dmg/config.json: docs.entries');
    expect(result.stdout).toBe('');
    expectNoStack(result.stderr);
  });
});

describe('dmg-core docs: ошибки ввода — код 2 и справка', () => {
  test('без --check', async () => {
    await put(temp().path, CLEAN);
    const result = run();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(USAGE_DOCS);
    expect(result.stdout).toBe('');
  });

  test('неизвестный флаг', async () => {
    await put(temp().path, CLEAN);
    const result = run('--check', '--fix');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--fix');
    expect(result.stderr).toContain(USAGE_DOCS);
  });

  test('лишний аргумент', async () => {
    await put(temp().path, CLEAN);
    const result = run('--check', 'docs');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(USAGE_DOCS);
  });

  test('только неизвестный флаг без --check', async () => {
    await put(temp().path, CLEAN);
    const result = run('--fix');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(USAGE_DOCS);
  });
});
