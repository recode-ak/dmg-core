/**
 * Проверка проекта-потребителя после установки tarball и `dmg-core init`
 * (`scripts/consumer-e2e.sh`): документация пакета на месте и без битых ссылок
 * (`docs --check` установленного CLI в корне пакета — ловит файлы, не
 * попавшие в `files`; направления D-59 не нужны — файлы те же, что в репо),
 * GritQL-плагины поставлены, init доставил конфиг, скил и вставку, пути
 * `node_modules/dmg-core/…` в доставленных копиях существуют.
 *
 *   bun scripts/consumer-check.ts <корень потребителя>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { DocFile } from './docs-check';

const PKG = 'node_modules/dmg-core';

/** Файлы, без которых потребитель не начнёт работу */
export const REQUIRED = [
  '.dmg/config.json',
  'AGENTS.md',
  '.claude/skills/dmg-architecture/SKILL.md',
  `${PKG}/llms.txt`,
  `${PKG}/README.md`,
  `${PKG}/docs/index.md`,
  `${PKG}/docs/reference/rules.md`,
];

/** GritQL-плагины пакета (lint-правила) — в установленном пакете */
export const PLUGINS = readdirSync(join(import.meta.dir, '../biome-plugins'))
  .filter((name) => name.endsWith('.grit'))
  .sort()
  .map((name) => `${PKG}/biome-plugins/${name}`);

/** Упоминание пути пакета: до пробела, кавычки, скобки или обратной кавычки */
const PACKAGE_PATH = /node_modules\/dmg-core\/[^\s`'")\]]*/g;

/** Пути `node_modules/dmg-core/…` в доставленных копиях ведут в существующие файлы */
export function checkDelivered(
  files: readonly DocFile[],
  exists: (path: string) => boolean,
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    for (const [match] of file.text.matchAll(PACKAGE_PATH)) {
      if (/[<*]/.test(match)) continue;
      const path = match.replace(/[.,:;]+$/, '').replace(/\/$/, '');
      if (!exists(path)) violations.push(`${file.path}: нет ${path}`);
    }
  }
  return violations;
}

/** Нарушение CLI: `<ПРАВИЛО>: <путь от корня пакета>…` */
const RULE_LINE = /^([A-Z]+-\d+): /;

/**
 * Дерево документации установленного пакета — его же командой `docs --check`
 * в корне пакета (`cli` — по умолчанию CLI поставки). Строки нарушений — с
 * путём от корня потребителя; отказ без строк нарушений — строкой с кодом.
 * Нет каталога пакета — пусто: его отсутствие ловит `REQUIRED`.
 */
export function checkPackageDocs(
  root: string,
  cli = join(root, PKG, 'src/cli/main.ts'),
): string[] {
  const cwd = join(root, PKG);
  if (!existsSync(cwd)) return [];
  const run = Bun.spawnSync([process.execPath, cli, 'docs', '--check'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (run.exitCode === 0) return [];
  const lines = run.stderr.toString().split('\n').filter(Boolean);
  const violations = lines
    .filter((line) => RULE_LINE.test(line))
    .map((line) => line.replace(RULE_LINE, `$1: ${PKG}/`));
  return violations.length > 0
    ? violations
    : [`${PKG}: docs --check — код ${run.exitCode}: ${lines.join(' ')}`];
}

/** Доставленные копии: скилы и роли Claude Code, файл инструкций */
function readDelivered(root: string): DocFile[] {
  const files: DocFile[] = [];
  for (const dir of ['.claude/skills', '.claude/agents']) {
    if (!existsSync(join(root, dir))) continue;
    const names = readdirSync(join(root, dir), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.md'))
      .sort();
    for (const name of names) {
      const path = posix.join(dir, name);
      files.push({ path, text: readFileSync(join(root, path), 'utf8') });
    }
  }
  if (existsSync(join(root, 'AGENTS.md'))) {
    files.push({
      path: 'AGENTS.md',
      text: readFileSync(join(root, 'AGENTS.md'), 'utf8'),
    });
  }
  return files;
}

if (import.meta.main) {
  const root = process.argv[2];
  if (!root) {
    console.error('Использование: bun scripts/consumer-check.ts <корень>');
    process.exit(2);
  }
  const exists = (path: string) => existsSync(join(root, path));
  const violations = [...REQUIRED, ...PLUGINS]
    .filter((path) => !exists(path))
    .map((path) => `нет ${path}`);
  const delivered = readDelivered(root);
  const agents = delivered.find((file) => file.path === 'AGENTS.md');
  if (agents && !agents.text.includes(`${PKG}/llms.txt`)) {
    violations.push(`AGENTS.md: нет ссылки на ${PKG}/llms.txt`);
  }
  violations.push(...checkDelivered(delivered, exists));
  violations.push(...checkPackageDocs(root));
  for (const line of violations) console.error(line);
  console.log(
    violations.length === 0
      ? 'consumer-check: документация, скилы и ссылки на месте'
      : `consumer-check: нарушений — ${violations.length}`,
  );
  process.exit(violations.length === 0 ? 0 : 1);
}
