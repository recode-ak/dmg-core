/**
 * Актуальность документов с `covers:` во front-matter (D-59): пути и шаблоны
 * исходников находят файлы; исходник, закоммиченный позже документа, —
 * предупреждение. `bun run docs:covers` в `check` предупреждает,
 * `--strict` в гейте релиза (`RELEASING.md`) блокирует.
 *
 * Чистые функции над файлами в памяти; диск и время коммитов — в `readCovers`.
 */
import { join, posix } from 'node:path';
import { Glob, spawnSync } from 'bun';
import { type DocFile, readDocs } from './docs-check';

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const COVERS_RE = /^covers:\n((?:[ \t]+- .*\n?)*)/m;
const COVERS_KEY_RE = /^covers:/m;

export interface CoversReport {
  /** Пути covers без файлов — `check` падает */
  missing: string[];
  /** Исходник менялся позже документа — предупреждение */
  stale: string[];
}

/** Пути и шаблоны из `covers:` front-matter; без front-matter — пусто */
export function coversOf(text: string): string[] {
  const front = FRONT_MATTER_RE.exec(text)?.[1];
  const list = front && COVERS_RE.exec(`${front}\n`)?.[1];
  if (!list) return [];
  return list
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter((path) => path !== '');
}

/** Время изменения `changedAt` — секунды коммита; без истории — `undefined` */
export function checkCovers(
  docs: readonly DocFile[],
  exists: (pattern: string) => boolean,
  changedAt: (pattern: string) => number | undefined,
): CoversReport {
  const report: CoversReport = { missing: [], stale: [] };
  for (const doc of docs) {
    const docTime = changedAt(doc.path);
    const patterns = coversOf(doc.text);
    const front = FRONT_MATTER_RE.exec(doc.text)?.[1] ?? '';
    if (patterns.length === 0 && COVERS_KEY_RE.test(front)) {
      report.missing.push(
        `${doc.path}: covers — не разобран, нужен список строк «  - путь»`,
      );
    }
    for (const pattern of patterns) {
      if (!exists(pattern)) {
        report.missing.push(`${doc.path}: covers — нет файлов ${pattern}`);
        continue;
      }
      const srcTime = changedAt(pattern);
      if (docTime !== undefined && srcTime !== undefined && srcTime > docTime) {
        report.stale.push(`${doc.path}: ${pattern} менялся позже документа`);
      }
    }
  }
  return report;
}

/** Код выхода `docs:covers`: путь без файлов — всегда 1, отставание — 1 только со `--strict` */
export function exitCode(report: CoversReport, strict: boolean): 0 | 1 {
  if (report.missing.length > 0) return 1;
  return strict && report.stale.length > 0 ? 1 : 0;
}

/**
 * Документы, чьи `covers` совпали с путями: файл — по шаблону, каталог — если
 * covers внутри него. Префикс до `dmg-core/` (`node_modules`, репо) отрезается.
 */
export function impactOf(
  docs: readonly DocFile[],
  paths: readonly string[],
): string[] {
  const rel = paths.map((p) =>
    p
      .replace(/^.*?dmg-core\//, '')
      .replace(/^\.\//, '')
      .replace(/\/$/, ''),
  );
  return docs
    .filter((doc) =>
      coversOf(doc.text).some((pattern) => {
        const glob = new Glob(pattern);
        return rel.some(
          (path) => glob.match(path) || pattern.startsWith(`${path}/`),
        );
      }),
    )
    .map((doc) => doc.path);
}

/**
 * Документы с `covers:`, поиск файлов по шаблону и время коммитов git пакета
 * с корнем `root`. Время — дата коммита: незакоммиченное не видно, rebase и
 * правка опечатки в документе сдвигают её.
 */
export function readCovers(root: string) {
  const docs = readDocs(root).files.filter(
    (f) =>
      !posix.basename(f.path).startsWith('_') &&
      COVERS_KEY_RE.test(FRONT_MATTER_RE.exec(f.text)?.[1] ?? ''),
  );
  const exists = (pattern: string) => {
    for (const _ of new Glob(pattern).scanSync({ cwd: root })) return true;
    return false;
  };
  const changedAt = (pattern: string) => {
    const git = spawnSync(
      ['git', 'log', '-1', '--format=%ct', '--', `:(glob)${pattern}`],
      { cwd: root },
    );
    const out = git.success ? git.stdout.toString().trim() : '';
    return out === '' ? undefined : Number(out);
  };
  return { docs, exists, changedAt };
}

if (import.meta.main) {
  const strict = process.argv.includes('--strict');
  const { docs, exists, changedAt } = readCovers(join(import.meta.dir, '..'));
  const report = checkCovers(docs, exists, changedAt);
  for (const line of report.missing) console.error(`error: ${line}`);
  for (const line of report.stale) console.warn(`warn: ${line}`);
  process.exit(exitCode(report, strict));
}
