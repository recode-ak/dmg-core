import type { SourceFile } from '../../arch/debt-checker.types';
import type { DocRegistries } from './doc-registries';
import type { DocReport } from './doc-report';
import type { IdGrammar } from './id-grammar';
import type { MarkdownDoc } from './markdown-doc';

/**
 * Ссылки на ID объявленных серий в документах и исходниках (DOC-07):
 * каждое упоминание ведёт на запись, закрытую запись или архив; серия без
 * реестра не проверяется. В документах — строки вне front-matter и блоков
 * кода, вставки в бэктиках — тоже; в исходниках — весь текст файла.
 * Нарушение — на каждое упоминание, со строкой файла.
 * @see src/cli/docs/doc-ids.test.ts
 */
export class DocIds {
  constructor(
    private readonly registries: DocRegistries,
    private readonly docs: readonly MarkdownDoc[],
    private readonly sources: readonly SourceFile[],
  ) {}

  report(into: DocReport): void {
    const grammar = this.registries.grammar();
    for (const doc of this.docs) {
      for (const { text, line, code } of doc.lines()) {
        if (!code) this.check(grammar, doc.path, line, text, into);
      }
    }
    for (const { path, text } of this.sources) {
      text.split('\n').forEach((line, i) => {
        this.check(grammar, path, i + 1, line, into);
      });
    }
  }

  private check(
    grammar: IdGrammar,
    path: string,
    line: number,
    text: string,
    into: DocReport,
  ): void {
    for (const { id, prefix, number } of grammar.find(text)) {
      if (this.registries.resolve(prefix, number).status !== 'missing') {
        continue;
      }
      into.add(
        'DOC-07',
        path,
        line,
        `ID ${id} без записи в реестре серии ${prefix}: заведи запись или поправь ID (docs-format.md § 6)`,
      );
    }
  }
}
