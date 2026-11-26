import { posix } from 'node:path';
import type { Violation } from '../../arch/violation';
import { DocReport } from './doc-report';
import type { MarkdownDoc } from './markdown-doc';

const RULE = 'DOC-04';

/**
 * Ссылки и якоря документов (DOC-04): цель внутри корня и существует, якорь
 * прочитанной цели ведёт на заголовок. `read` — документ по пути от корня
 * (обхода или прочитанный ради якорей), `exists` — есть ли путь.
 * @see src/cli/docs/doc-links.test.ts
 */
export class DocLinks {
  constructor(
    private readonly docs: readonly MarkdownDoc[],
    private readonly read: (path: string) => MarkdownDoc | undefined,
    private readonly exists: (path: string) => boolean,
  ) {}

  /** Путь цели от корня: `posix` от каталога файла `from`; пустая цель — сам файл */
  static resolve(from: string, target: string): string {
    if (target === '') return from;
    return posix.normalize(posix.join(posix.dirname(from), target));
  }

  check(): Violation[] {
    const report = new DocReport();
    this.report(report);
    return report.violations();
  }

  /** Нарушения — в общий отчёт проверки дерева */
  report(into: DocReport): void {
    for (const doc of this.docs) {
      for (const { href, target, anchor, line } of doc.links()) {
        const path = DocLinks.resolve(doc.path, target);
        if (path.startsWith('..')) {
          into.add(
            RULE,
            doc.path,
            line,
            `ссылка ${href} выходит за корень: укажи путь внутри проекта`,
          );
        } else if (!this.exists(path)) {
          into.add(
            RULE,
            doc.path,
            line,
            `ссылка ${href} ведёт в несуществующий ${path}: исправь путь или убери ссылку`,
          );
        } else if (
          anchor !== undefined &&
          this.read(path)?.hasAnchor(anchor) === false
        ) {
          into.add(
            RULE,
            doc.path,
            line,
            `битый якорь ${href} (в ${path} нет такого заголовка): поправь якорь или заголовок`,
          );
        }
      }
    }
  }
}
