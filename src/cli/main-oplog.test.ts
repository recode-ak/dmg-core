import { describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from '#core/testing/index';

const MAIN = join(import.meta.dir, 'main.ts');
const LEGACY = join(import.meta.dir, '../app/oplog/fixtures/legacy');

const temp = useTempDir('dmg-core-oplog-cli-');

function run(...args: string[]) {
  const proc = Bun.spawnSync(['bun', MAIN, ...args], { cwd: temp().path });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Копия фикстуры старого формата — каталог лога без пакета проекта рядом. */
function logDir(): string {
  const dir = join(temp().path, 'oplog');
  mkdirSync(dir, { recursive: true });
  cpSync(LEGACY, dir, { recursive: true });
  return dir;
}

describe('dmg-core oplog', () => {
  test('флаги — фильтр по И, лента по at, пакет проекта не нужен', () => {
    const dir = logDir();
    writeFileSync(
      join(dir, '2026-11-14.jsonl'),
      `${JSON.stringify({
        at: Date.UTC(2026, 10, 14),
        module: 'stream',
        op: 'completeStudent',
        kind: 'useCase',
        caller: { kind: 'guest' },
        trace: {
          cause: { kind: 'request', requestId: 'x' },
          correlationId: 'x',
        },
        input: {},
        result: { ok: true, output: {} },
        events: [],
        writes: [],
        durationMs: 1,
      })}\n`,
    );
    expect(run('oplog', dir).stdout.trimEnd().split('\n')).toHaveLength(6);
    const result = run(
      'oplog',
      dir,
      '--request',
      'tg:1004',
      '--module',
      'stream',
      '--op',
      'completeStudent',
      '--since',
      '2026-11-13',
      '--until',
      '2026-11-14',
    );
    expect(result).toMatchObject({ code: 0, stderr: '' });
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('stream.completeStudent');
  });

  test('--json: исходные записи построчно', () => {
    const result = run('oplog', logDir(), '--json', '--module', 'stream');
    expect(result.code).toBe(0);
    const rows = result.stdout
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ module: 'stream', op: 'completeStudent' });
  });

  test('без каталога — код 2 и USAGE', () => {
    const result = run('oplog');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('dmg-core oplog <dir>');
  });

  test('каталога нет — код 2, каталог назван', () => {
    const result = run('oplog', 'нет-такого');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('нет-такого');
    expect(result.stdout).toBe('');
  });

  test('ошибка флагов — код 2, флаг назван, USAGE', () => {
    const cases: [string[], string][] = [
      [['--color'], '--color'],
      [['module', 'stream'], 'module'],
      [['--module'], '--module'],
      [['--module', '--json'], '--module'],
      [['--since', 'вчера'], 'вчера'],
    ];
    for (const [args, named] of cases) {
      const result = run('oplog', logDir(), ...args);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(named);
      expect(result.stdout).toBe('');
    }
    expect(run('oplog', logDir(), '--color').stderr).toContain(
      'dmg-core oplog <dir>',
    );
  });
});
