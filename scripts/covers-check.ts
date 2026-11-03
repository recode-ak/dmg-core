/**
 * Актуальность документов с `covers:` во front-matter (D-59): пути и шаблоны
 * исходников находят файлы; исходник, закоммиченный позже документа или его
 * сверки (`verified: <sha>` — документ сверен с кодом на этом коммите), —
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
const VERIFIED_RE = /^verified:[ \t]*(\S+)[ \t]*$/m;

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

/**
 * Время `changedAt` и `verifiedAt` — секунды коммита; без истории или коммита —
 * `undefined`. Документ свеж с позднего из двух: своей правки и `verified`.
 */
export function checkCovers(
  docs: readonly DocFile[],
  exists: (pattern: string) => boolean,
  changedAt: (pattern: string) => number | undefined,
  verifiedAt: (sha: string) => number | undefined,
): CoversReport {
  const report: CoversReport = { missing: [], stale: [] };
  for (const doc of docs) {
    const patterns = coversOf(doc.text);
    const front = FRONT_MATTER_RE.exec(doc.text)?.[1] ?? '';
    const sha = VERIFIED_RE.exec(front)?.[1];
    const shaTime = sha === undefined ? undefined : verifiedAt(sha);
    if (sha !== undefined && shaTime === undefined) {
      report.missing.push(`${doc.path}: verified — нет коммита ${sha}`);
    }
    const editTime = changedAt(doc.path);
    const docTime =
      editTime === undefined ? undefined : Math.max(editTime, shaTime ?? 0);
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

// Не код: пустая строка и строка, начатая с `//`, `/*` или `*` (тело и конец
// JSDoc), без кода после `*/`. Допущение: строка кода с `*` в начале
// (генератор, продолжение умножения) считается комментарием.
function isCodeLine(line: string): boolean {
  const text = line.trim();
  if (text === '') return false;
  if (!/^(\/\/|\/\*|\*)/.test(text)) return true;
  return !text.startsWith('//') && /\*\/\s*\S/.test(text);
}

/**
 * Время последнего коммита, менявшего код, по выводу
 * `git log --format=@%ct -p -U0` (новые первыми). Коммиты только с
 * комментариями и пустыми строками пропускаются: стрижка JSDoc не делает
 * документ устаревшим.
 */
export function lastCodeChangeAt(log: string): number | undefined {
  let time: number | undefined;
  let inHunk = false;
  for (const line of log.split('\n')) {
    if (line.startsWith('@') && !line.startsWith('@@')) {
      time = Number(line.slice(1));
      inHunk = false;
    } else if (line.startsWith('diff --git')) {
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && /^[+-]/.test(line) && isCodeLine(line.slice(1))) {
      return time;
    }
  }
  return undefined;
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
 * правка опечатки в документе сдвигают её. У исходников — последний коммит,
 * менявший код (`lastCodeChangeAt`), без тестов: новый тест поведение не меняет.
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
    if (!pattern.endsWith('.md')) {
      const git = spawnSync(
        [
          'git',
          'log',
          '--format=@%ct',
          '-p',
          '-U0',
          '--no-color',
          '--',
          `:(glob)${pattern}`,
          ':(exclude,glob)**/*.test.ts',
        ],
        { cwd: root },
      );
      return git.success ? lastCodeChangeAt(git.stdout.toString()) : undefined;
    }
    const git = spawnSync(
      ['git', 'log', '-1', '--format=%ct', '--', `:(glob)${pattern}`],
      { cwd: root },
    );
    const out = git.success ? git.stdout.toString().trim() : '';
    return out === '' ? undefined : Number(out);
  };
  const verifiedAt = (sha: string) => {
    const git = spawnSync(
      ['git', 'log', '-1', '--format=%ct', `${sha}^{commit}`, '--'],
      { cwd: root },
    );
    const out = git.success ? git.stdout.toString().trim() : '';
    return out === '' ? undefined : Number(out);
  };
  return { docs, exists, changedAt, verifiedAt };
}

if (import.meta.main) {
  const strict = process.argv.includes('--strict');
  const { docs, exists, changedAt, verifiedAt } = readCovers(
    join(import.meta.dir, '..'),
  );
  const report = checkCovers(docs, exists, changedAt, verifiedAt);
  for (const line of report.missing) console.error(`error: ${line}`);
  for (const line of report.stale) console.warn(`warn: ${line}`);
  process.exit(exitCode(report, strict));
}
