import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkDelivered,
  checkPackageDocs,
  PLUGINS,
  REQUIRED,
} from './consumer-check';

const EXISTING = new Set([
  'node_modules/dmg-core/llms.txt',
  'node_modules/dmg-core/docs',
  'node_modules/dmg-core/docs/reference/rules.md',
]);
const exists = (path: string) => EXISTING.has(path);
const file = (
  text: string,
  path = '.claude/skills/dmg-architecture/SKILL.md',
) => ({
  path,
  text,
});

describe('checkDelivered: пути пакета в доставленных копиях', () => {
  it('существующие пути (файл и каталог) — без нарушений', () => {
    expect(
      checkDelivered(
        [
          file(
            'Вход — `node_modules/dmg-core/docs/` и `node_modules/dmg-core/llms.txt`.\n' +
              'Правила: node_modules/dmg-core/docs/reference/rules.md.',
          ),
        ],
        exists,
      ),
    ).toEqual([]);
  });

  it('несуществующий путь — нарушение с файлом копии', () => {
    expect(
      checkDelivered(
        [file('См. `node_modules/dmg-core/docs/gone.md`', 'AGENTS.md')],
        exists,
      ),
    ).toEqual(['AGENTS.md: нет node_modules/dmg-core/docs/gone.md']);
  });

  it('шаблоны с <…> и * не проверяются', () => {
    expect(
      checkDelivered(
        [
          file(
            '`node_modules/dmg-core/docs/guides/<вид>.md`, node_modules/dmg-core/src/*',
          ),
        ],
        exists,
      ),
    ).toEqual([]);
  });
});

describe('checkPackageDocs: docs --check в корне установленного пакета', () => {
  // CLI репо вместо установленного: во временном «пакете» только документы.
  const cli = join(import.meta.dir, '../src/cli/main.ts');
  const roots: string[] = [];
  const consumer = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'consumer-check-'));
    roots.push(root);
    for (const [path, text] of Object.entries(files)) {
      const full = join(root, 'node_modules/dmg-core', path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    return root;
  };
  const llms = '# dmg-core\n\n- [Оглавление](docs/index.md): ищешь раздел\n';
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  });

  it('все цели ссылок в поставке — без нарушений', () => {
    const root = consumer({
      'llms.txt': llms,
      'docs/index.md': '# Оглавление\n',
    });
    expect(checkPackageDocs(root, cli)).toEqual([]);
  });

  it('отказ CLI без строк нарушений — строка с кодом и выводом', () => {
    const root = consumer({
      'llms.txt': llms,
      'fail.ts': "console.error('сбой');\nprocess.exit(3);\n",
    });
    const stub = join(root, 'node_modules/dmg-core/fail.ts');
    expect(checkPackageDocs(root, stub)).toEqual([
      'node_modules/dmg-core: docs --check — код 3: сбой',
    ]);
  });

  it('CLI убит сигналом — строка с сигналом', () => {
    const root = consumer({
      'llms.txt': llms,
      'kill.ts': "process.kill(process.pid, 'SIGKILL');\n",
    });
    const stub = join(root, 'node_modules/dmg-core/kill.ts');
    expect(checkPackageDocs(root, stub)).toEqual([
      'node_modules/dmg-core: docs --check — сигнал SIGKILL',
    ]);
  });

  it('цель не попала в поставку — нарушение с путём от корня потребителя', () => {
    const root = consumer({ 'llms.txt': llms });
    expect(checkPackageDocs(root, cli)).toEqual([
      'DOC-04: node_modules/dmg-core/llms.txt:3 — ссылка docs/index.md ведёт в несуществующий docs/index.md: исправь путь или убери ссылку',
    ]);
  });
});

it('REQUIRED: init доставляет конфиг, скил и вставку; пакет несёт индекс и правила', () => {
  expect(REQUIRED).toEqual([
    '.dmg/config.json',
    'AGENTS.md',
    '.claude/skills/dmg-architecture/SKILL.md',
    'node_modules/dmg-core/llms.txt',
    'node_modules/dmg-core/README.md',
    'node_modules/dmg-core/docs/index.md',
    'node_modules/dmg-core/docs/reference/rules.md',
  ]);
});

it('PLUGINS: все GritQL-плагины пакета — в установленном пакете', () => {
  expect(PLUGINS).toEqual([
    'node_modules/dmg-core/biome-plugins/api-02-no-manual-publish.grit',
    'node_modules/dmg-core/biome-plugins/api-05-step-methods.grit',
    'node_modules/dmg-core/biome-plugins/api-07-no-call-in-load.grit',
    'node_modules/dmg-core/biome-plugins/arc-09-no-env.grit',
    'node_modules/dmg-core/biome-plugins/code-02-class-members.grit',
    'node_modules/dmg-core/biome-plugins/dom-11-base-fields.grit',
    'node_modules/dmg-core/biome-plugins/dom-12-no-iso-dates.grit',
    'node_modules/dmg-core/biome-plugins/dom-14-no-clock.grit',
    'node_modules/dmg-core/biome-plugins/dom-17-snapshot-repo-only.grit',
    'node_modules/dmg-core/biome-plugins/dom-17-state-uow-only.grit',
    'node_modules/dmg-core/biome-plugins/err-01-no-throw.grit',
  ]);
});
