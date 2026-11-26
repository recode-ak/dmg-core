import type { DocKind } from './docs.types';
import type { DocsSettings } from './docs-settings';
import type { MarkdownDoc } from './markdown-doc';

/** Скил — маршрут: `SKILL.md` прямо в каталоге скила, в том числе под `.claude/` */
const SKILL_RE = /(?:^|\/)skills\/[^/]+\/SKILL\.md$/;

/**
 * Вид документа по таблице `docs-format.md` § 1: первый подходящий признак —
 * генерируемое, вход, реестр, оглавление, лист.
 * @see src/cli/docs/doc-kinds.test.ts
 */
export class DocKinds {
  constructor(private readonly settings: DocsSettings) {}

  of(doc: MarkdownDoc): DocKind {
    const { path } = doc;
    if (this.settings.isGenerated(path)) return 'generated';
    if (this.settings.entries.includes(path)) return 'entry';
    if (doc.isRegistry()) return 'registry';
    if (
      path === 'index.md' ||
      path.endsWith('/index.md') ||
      SKILL_RE.test(path)
    )
      return 'index';
    return 'leaf';
  }
}
