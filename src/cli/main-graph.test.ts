import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempDir } from '#core/testing/index';
import pkg from '../../package.json';

const MAIN = join(import.meta.dir, 'main.ts');
const EXAMPLE = join(import.meta.dir, '../testing/example/example.graph.ts');
const VALIBOT = join(import.meta.dir, '../../node_modules/valibot');
const USAGE_GRAPH = 'dmg-core graph <файл> [--out <путь>]';

const temp = useTempDir('dmg-core-graph-cli-');

/** Процесс `bun main.ts graph …` в каталоге проекта с `package.json`. */
function run(...args: string[]) {
  const proc = Bun.spawnSync(['bun', MAIN, 'graph', ...args], {
    cwd: temp().path,
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function writeProject(manifest: object = { version: '1.2.3' }): void {
  writeFileSync(
    join(temp().path, 'package.json'),
    JSON.stringify({ name: 'demo', ...manifest }),
  );
}

/** Пишет файл-вход во временный каталог и возвращает его путь. */
function writeEntry(name: string, source: string): string {
  const file = join(temp().path, name);
  writeFileSync(file, source);
  return file;
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Отказ без стека: ни строк `    at `, ни имени исключения. */
function expectNoStack(stderr: string): void {
  expect(stderr).not.toMatch(/^\s+at /m);
  expect(stderr).not.toContain('GraphError:');
  expect(stderr).not.toMatch(/^error:/m);
}

describe('dmg-core graph', () => {
  test('успех: graph.json в cwd, шапка и узлы с поставщиком', () => {
    writeProject();
    const result = run(EXAMPLE);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const out = join(temp().path, 'graph.json');
    expect(result.stdout).toMatch(
      /^Записан: .*graph\.json \(узлов — \d+, рёбер — \d+, внешних ссылок — \d+\)$/m,
    );
    expect(existsSync(out)).toBe(true);
    const doc = readJson(out);
    expect(doc.format).toBe(1);
    expect(doc.app).toEqual({ name: 'example', version: '1.2.3' });
    expect(doc.providers).toHaveLength(1);
    expect(doc.providers[0]).toMatchObject({
      name: 'dmg-core',
      version: pkg.version,
    });
    expect(doc.nodes[0]).toMatchObject({ id: 'example', kind: 'app' });
    expect(doc.nodes.length).toBeGreaterThan(1);
    expect(doc.edges.length).toBeGreaterThan(0);
    for (const item of [...doc.nodes, ...doc.edges]) {
      expect(typeof item.provider).toBe('string');
      expect(item.provider).not.toBe('');
    }
    const counts = `узлов — ${doc.nodes.length}, рёбер — ${doc.edges.length}, внешних ссылок — ${doc.externals.length}`;
    expect(result.stdout).toContain(counts);
  });

  test('два прогона — файлы побайтно равны', () => {
    writeProject();
    const out = join(temp().path, 'graph.json');
    expect(run(EXAMPLE).code).toBe(0);
    const first = readFileSync(out);
    expect(run(EXAMPLE).code).toBe(0);
    expect(readFileSync(out).equals(first)).toBe(true);
  });

  test('--out sub/g.json: файл там, каталог создан', () => {
    writeProject();
    const result = run(EXAMPLE, '--out', 'sub/g.json');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('sub/g.json');
    expect(existsSync(join(temp().path, 'sub/g.json'))).toBe(true);
    expect(readJson(join(temp().path, 'sub/g.json')).format).toBe(1);
    expect(existsSync(join(temp().path, 'graph.json'))).toBe(false);
  });

  test('без файла — код 2, сообщение и USAGE', () => {
    writeProject();
    const result = run();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('graph: не указан файл приложения');
    expect(result.stderr).toContain(USAGE_GRAPH);
    expect(result.stdout).toBe('');
  });

  test('неизвестный флаг — код 2, флаг назван, USAGE', () => {
    writeProject();
    const result = run(EXAMPLE, '--color');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('graph: неизвестный флаг --color');
    expect(result.stderr).toContain(USAGE_GRAPH);
    expect(existsSync(join(temp().path, 'graph.json'))).toBe(false);
  });

  test('--out без значения — код 2, сообщение и USAGE', () => {
    writeProject();
    const result = run(EXAMPLE, '--out');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('graph: у флага --out нет значения');
    expect(result.stderr).toContain(USAGE_GRAPH);
    expect(existsSync(join(temp().path, 'graph.json'))).toBe(false);
  });

  test('файла нет — код 1, путь назван, без стека', () => {
    writeProject();
    const result = run('нет-такого.ts');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('graph: нет файла ');
    expect(result.stderr).toContain('нет-такого.ts');
    expectNoStack(result.stderr);
    expect(result.stdout).toBe('');
  });

  test('экспорт не той формы — код 1, требуемая форма названа', () => {
    writeProject();
    const file = writeEntry('wrong.ts', 'export default { providers: [] };\n');
    const result = run(file);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'нужен export default { def: AppDef, providers?: GraphProvider[] }',
    );
    expect(result.stderr).toContain('graph: ');
    expect(result.stderr).toContain('wrong.ts');
    expectNoStack(result.stderr);
    expect(existsSync(join(temp().path, 'graph.json'))).toBe(false);
  });

  test('нет version в package.json — код 1, без стека', () => {
    writeProject({});
    const result = run(EXAMPLE);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'graph: в package.json проекта нет version',
    );
    expectNoStack(result.stderr);
    expect(existsSync(join(temp().path, 'graph.json'))).toBe(false);
  });

  test('GraphError — код 1, текст ошибки, без стека', () => {
    writeProject();
    const file = writeEntry(
      'conflict.ts',
      `import * as v from '${VALIBOT}';
import { ExampleAppDef } from '${join(import.meta.dir, '../testing/example/example.app.ts')}';
export default {
  def: ExampleAppDef,
  providers: [
    {
      name: 'ext',
      version: '1',
      kinds: () => ({
        nodes: [
          { kind: 'module', label: 'M', description: 'd', props: v.strictObject({}) },
        ],
        edges: [],
      }),
      contribute: () => ({ nodes: [], edges: [] }),
    },
  ],
};
`,
    );
    const result = run(file);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('graph: ');
    expect(result.stderr).toContain('Вид узла «module» уже зарегистрирован');
    expectNoStack(result.stderr);
    expect(existsSync(join(temp().path, 'graph.json'))).toBe(false);
  });
});
