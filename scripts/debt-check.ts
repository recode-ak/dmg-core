/**
 * Реестр долгов пакета (`debt.md` в корне репо, в tarball не входит):
 * каждый маркер долга в коде (`src/`, `scripts/`, без тестов) имеет запись
 * `### <ID>: …` и наоборот. Запускается тестом `debt-check.test.ts`.
 *
 * Чистая функция над файлами в памяти; чтение диска — в `readDebt`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';
import type { DocFile } from './docs-check';

const DEBT_MD = 'debt.md';
const CODE_GLOBS = ['src/**/*.ts', 'scripts/**/*.ts'];
const MARKER_RE = /\b(DEBT-\d+)\b/g;
const ENTRY_RE = /^###\s+(DEBT-\d+)\b/gm;

export function checkDebt(code: readonly DocFile[], debtMd: string): string[] {
  const inCode = new Map<string, string>();
  for (const file of code)
    for (const [, id = ''] of file.text.matchAll(MARKER_RE))
      if (!inCode.has(id)) inCode.set(id, file.path);
  const inMd = new Set([...debtMd.matchAll(ENTRY_RE)].map((m) => m[1] ?? ''));

  const violations: string[] = [];
  for (const [id, path] of inCode)
    if (!inMd.has(id))
      violations.push(
        `DEBT: ${id} есть в коде (${path}), но нет записи в ${DEBT_MD}`,
      );
  for (const id of inMd)
    if (!inCode.has(id))
      violations.push(`DEBT: ${id} есть в ${DEBT_MD}, но нет маркера в коде`);
  return violations;
}

/** Код (без тестов) и реестр долгов пакета с корнем `root`. */
export function readDebt(root: string) {
  const code: DocFile[] = [];
  for (const pattern of CODE_GLOBS)
    for (const path of new Glob(pattern).scanSync(root))
      if (!path.endsWith('.test.ts'))
        code.push({ path, text: readFileSync(join(root, path), 'utf8') });
  return { code, debtMd: readFileSync(join(root, DEBT_MD), 'utf8') };
}
