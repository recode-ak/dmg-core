/**
 * Контрактная проверка документации пакета (`docs/`, `skills/`, `agents/`,
 * `llms.txt`): ссылки на файлы живые, не выходят за пределы пакета и идут по
 * направлению D-59, якоря ведут на заголовки, ID правил есть в
 * `docs/rules.md`; пути в `@see` JSDoc `src/` живые. Запускается тестом
 * `docs-check.test.ts`.
 *
 * Чистые функции над файлами в памяти; чтение диска — в `readDocs`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Glob } from 'bun';

/** Файл документации: путь от корня пакета и текст */
export interface DocFile {
  path: string;
  text: string;
}

const DOC_DIRS = ['docs', 'skills', 'agents'];
const DOC_FILES = ['llms.txt', 'README.md'];
const SOURCE_GLOB = 'src/**/*.ts';
const RULES_PATH = 'docs/rules.md';
const LINK_RE = /\]\(([^)\s]+)\)/g;
const SEE_RE = /@see\s+(\S+?)[.,;:)]*(?=\s|$)/g;
const SEE_PATH_RE = /\.(?:md|ts)$/;
const RULE_RE = /\b(?:ARC|DOM|MAN|ERR|API|CODE|TST)-\d{2}\b/g;
const EXTERNAL = /^[a-z]+:/i;

type Kind =
  | 'concepts'
  | 'guides'
  | 'reference'
  | 'decisions'
  | 'example'
  | 'src'
  | 'other';

/**
 * Куда может ссылаться документ своего типа. Типы без записи —
 * смешанные документы корня `docs/`, входы и скилы — не ограничены.
 */
const ALLOWED: Partial<Record<Kind, ReadonlySet<Kind>>> = {
  concepts: new Set([
    'concepts',
    'guides',
    'reference',
    'decisions',
    'example',
    'other',
  ]),
  guides: new Set(['guides', 'concepts', 'reference', 'example', 'other']),
  reference: new Set(['reference', 'decisions']),
};

function kindOf(path: string): Kind {
  if (path.startsWith('docs/concepts/')) return 'concepts';
  if (path.startsWith('docs/guides/')) return 'guides';
  if (path.startsWith('docs/reference/')) return 'reference';
  if (path === 'docs/decisions.md') return 'decisions';
  if (path.startsWith('src/testing/example/')) return 'example';
  if (path.startsWith('src/')) return 'src';
  return 'other';
}

/** Якоря заголовков markdown по правилам GitHub, без заголовков в блоках кода */
function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const slug = (heading[1] ?? '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

function decoded(anchor: string): string {
  try {
    return decodeURIComponent(anchor);
  } catch {
    return anchor;
  }
}

function anchorIndex(files: readonly DocFile[]) {
  const index = new Map(files.map((f) => [f.path, anchorsOf(f.text)]));
  /** Якорь битый: файл известен как документ, а заголовка нет; пустой якорь — не якорь */
  return (path: string, anchor: string) =>
    anchor !== '' && index.get(path)?.has(decoded(anchor)) === false;
}

export function checkDocs(
  files: readonly DocFile[],
  exists: (path: string) => boolean,
  rules: ReadonlySet<string>,
): string[] {
  const broken = anchorIndex(files);
  const violations: string[] = [];
  for (const file of files) {
    const allowed = ALLOWED[kindOf(file.path)];
    for (const [, href = ''] of file.text.matchAll(LINK_RE)) {
      const [target = '', anchor] = href.split('#');
      if (EXTERNAL.test(target)) continue;
      const resolved =
        target === ''
          ? file.path
          : posix.normalize(posix.join(posix.dirname(file.path), target));
      const kind = kindOf(resolved);
      if (resolved.startsWith('..')) {
        violations.push(
          `${file.path}: ссылка выходит за пределы пакета ${target}`,
        );
      } else if (!exists(resolved)) {
        violations.push(
          `${file.path}: ссылка ведёт в несуществующий файл ${target}`,
        );
      } else if (anchor !== undefined && broken(resolved, anchor)) {
        violations.push(`${file.path}: битый якорь ${href}`);
      } else if (allowed && !allowed.has(kind)) {
        violations.push(
          `${file.path}: ссылка против направления (${kindOf(file.path)} → ${kind}) ${target}`,
        );
      }
    }
    const ids = new Set([...file.text.matchAll(RULE_RE)].map((m) => m[0]));
    for (const id of ids) {
      if (!rules.has(id)) {
        violations.push(`${file.path}: правило ${id} нет в ${RULES_PATH}`);
      }
    }
  }
  return violations;
}

/** Пути в `@see` (от корня пакета, `*.md` и `*.ts`) живые, якоря — на заголовки `docs` */
export function checkSee(
  sources: readonly DocFile[],
  docs: readonly DocFile[],
  exists: (path: string) => boolean,
): string[] {
  const broken = anchorIndex(docs);
  const violations: string[] = [];
  for (const file of sources) {
    for (const [, ref = ''] of file.text.matchAll(SEE_RE)) {
      const [target = '', anchor] = ref.split('#');
      if (!SEE_PATH_RE.test(target)) continue;
      if (!exists(posix.normalize(target))) {
        violations.push(
          `${file.path}: @see ведёт в несуществующий файл ${target}`,
        );
      } else if (anchor !== undefined && broken(target, anchor)) {
        violations.push(`${file.path}: @see — битый якорь ${ref}`);
      }
    }
  }
  return violations;
}

/** Документация, исходники, проверка существования и ID правил пакета с корнем `root`. */
export function readDocs(root: string) {
  const read = (path: string): DocFile => ({
    path,
    text: readFileSync(join(root, path), 'utf8'),
  });
  const files: DocFile[] = [];
  for (const dir of DOC_DIRS) {
    if (!existsSync(join(root, dir))) continue;
    const names = readdirSync(join(root, dir), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.md'))
      .sort();
    for (const name of names) files.push(read(posix.join(dir, name)));
  }
  for (const path of DOC_FILES) {
    if (existsSync(join(root, path))) files.push(read(path));
  }
  const sources = [...new Glob(SOURCE_GLOB).scanSync({ cwd: root })]
    .sort()
    .map(read);
  const rulesText = readFileSync(join(root, RULES_PATH), 'utf8');
  const rules = new Set(
    [...rulesText.matchAll(/^\| ([A-Z]+-\d{2}) \|/gm)].map((m) => m[1] ?? ''),
  );
  return {
    files,
    sources,
    exists: (path: string) => existsSync(join(root, path)),
    rules,
  };
}
