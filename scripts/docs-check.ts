/**
 * Свои проверки документации пакета сверх `dmg-core docs --check`: направления
 * ссылок D-59 и `@see` в `src/`. Ссылки и якоря — `src/cli/docs`, ID серий
 * реестров (правила, `GR-NN`, решения) — DOC-07 команды; README от `llms.txt`
 * недостижим, его ссылки держит `checkLinks` по `readDocs`.
 * @see scripts/docs-check.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Glob } from 'bun';
import { DocLinks } from '../src/cli/docs/doc-links';
import { MarkdownDoc } from '../src/cli/docs/markdown-doc';

/** Файл документации: путь от корня пакета и текст */
export interface DocFile {
  path: string;
  text: string;
}

const DOC_DIRS = ['docs', 'skills', 'agents'];
const DOC_FILES = ['llms.txt', 'README.md'];
const SOURCE_GLOB = 'src/**/*.ts';
const SEE_RE = /@see\s+(\S+?)[.,;:)]*(?=\s|$)/g;
const SEE_PATH_RE = /\.(?:md|ts)$/;

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
 * `decisions.md`, входы (`docs/index.md`, `llms.txt`, README), скилы и
 * роли — не ограничены.
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

/** Документы по пути: якоря и ссылки — через `MarkdownDoc` */
function docsOf(files: readonly DocFile[]): Map<string, MarkdownDoc> {
  return new Map(files.map((f) => [f.path, new MarkdownDoc(f.path, f.text)]));
}

/** Ссылки и якоря (DOC-04) — реализацией команды `docs --check`; строки `DOC-04: …` */
export function checkLinks(
  files: readonly DocFile[],
  exists: (path: string) => boolean,
): string[] {
  const docs = docsOf(files);
  return new DocLinks([...docs.values()], (path) => docs.get(path), exists)
    .check()
    .map((violation) => violation.format());
}

/**
 * Направления ссылок D-59. Ссылка за корень направлением не считается — её
 * ловит `checkLinks`.
 */
export function checkDocs(files: readonly DocFile[]): string[] {
  const violations: string[] = [];
  for (const [path, doc] of docsOf(files)) {
    const allowed = ALLOWED[kindOf(path)];
    if (!allowed) continue;
    for (const { target } of doc.links()) {
      const resolved = DocLinks.resolve(path, target);
      const kind = kindOf(resolved);
      if (!resolved.startsWith('..') && !allowed.has(kind)) {
        violations.push(
          `${path}: ссылка против направления (${kindOf(path)} → ${kind}) ${target}`,
        );
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
  const known = docsOf(docs);
  const violations: string[] = [];
  for (const file of sources) {
    for (const [, ref = ''] of file.text.matchAll(SEE_RE)) {
      const [target = '', anchor] = ref.split('#');
      if (!SEE_PATH_RE.test(target)) continue;
      if (!exists(posix.normalize(target))) {
        violations.push(
          `${file.path}: @see ведёт в несуществующий файл ${target}`,
        );
      } else if (
        anchor !== undefined &&
        known.get(target)?.hasAnchor(anchor) === false
      ) {
        violations.push(`${file.path}: @see — битый якорь ${ref}`);
      }
    }
  }
  return violations;
}

/** Документация, исходники и проверка существования пакета с корнем `root`. */
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
  return {
    files,
    sources,
    exists: (path: string) => existsSync(join(root, path)),
  };
}
