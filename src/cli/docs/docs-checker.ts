import type { Violation } from '../../arch/violation';
import { DocKinds } from './doc-kinds';
import { DocLinks } from './doc-links';
import { DocReport } from './doc-report';
import type { DocKind, DocsTreeRead } from './docs.types';
import type { DocsSettings } from './docs-settings';
import type { MarkdownDoc } from './markdown-doc';

/** Имя вида в сообщении бюджета */
const KIND_NAMES: Readonly<Record<'entry' | 'index' | 'leaf', string>> = {
  entry: 'входа',
  index: 'оглавления',
  leaf: 'листа',
};

/**
 * Проверки дерева документов: вид и бюджет (DOC-01), подпись во входе и
 * оглавлении (DOC-02), ссылки и якоря (DOC-04), входы и исключения (DOC-05).
 * `exempt` снимает DOC-01 и DOC-02, ссылки файла проверяются.
 * @see src/cli/docs/docs-checker.test.ts
 */
export class DocsChecker {
  constructor(private readonly settings: DocsSettings) {}

  /** Нарушения, отсортированные по пути и номеру строки */
  check(tree: DocsTreeRead): Violation[] {
    const report = new DocReport();
    const kinds = new DocKinds(this.settings);
    for (const doc of tree.docs) {
      if (this.settings.isExempt(doc.path)) continue;
      const kind = kinds.of(doc);
      this.budget(doc, kind, report);
      if (kind === 'entry' || kind === 'index') this.captions(doc, report);
    }
    const byPath = new Map(tree.docs.map((doc) => [doc.path, doc]));
    new DocLinks(
      tree.docs,
      (path) => byPath.get(path) ?? tree.targets.get(path),
      tree.exists,
    ).report(report);
    for (const entry of tree.missingEntries) {
      report.add(
        'DOC-05',
        entry,
        undefined,
        'вход не найден: создай файл или поправь docs.entries в .dmg/config.json',
      );
    }
    for (const path of this.settings.exemptPaths) {
      const text = !tree.exists(path)
        ? 'исключение на несуществующий путь: убери его из docs.exempt в .dmg/config.json'
        : !path.endsWith('/') && tree.exists(`${path}/`)
          ? `каталог — с / на конце: ${path}/ в docs.exempt`
          : undefined;
      if (text) report.add('DOC-05', path, undefined, text);
    }
    return report.violations();
  }

  private budget(doc: MarkdownDoc, kind: DocKind, report: DocReport): void {
    if (kind === 'generated' || kind === 'registry') return;
    const limit = this.settings.limits[kind];
    if (doc.lineCount <= limit) return;
    report.add(
      'DOC-01',
      doc.path,
      undefined,
      `строк ${doc.lineCount}, бюджет ${KIND_NAMES[kind]} ${limit}: раздели по темам (docs-format.md § 1)`,
    );
  }

  private captions(doc: MarkdownDoc, report: DocReport): void {
    const limit = this.settings.limits.caption;
    const separator = doc.path.endsWith('.txt') ? ':' : '—';
    for (const { line, caption } of doc.listItems()) {
      if (caption === undefined) {
        report.add(
          'DOC-02',
          doc.path,
          line,
          `у ссылки нет подписи: допиши «${separator} когда открыть» (docs-format.md § 3)`,
        );
        continue;
      }
      const length = [...caption].length;
      if (length <= limit) continue;
      report.add(
        'DOC-02',
        doc.path,
        line,
        `подпись ${length} знаков, предел ${limit}: оставь ситуацию читателя, факты — в лист (docs-format.md § 3)`,
      );
    }
  }
}
