import { type Stats, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocLinks } from './doc-links';
import type { DocsTreeRead } from './docs.types';
import type { DocsSettings } from './docs-settings';
import { MarkdownDoc } from './markdown-doc';

/** Дерево чужого пакета: его проверяет сам пакет */
const NODE_MODULES_RE = /(?:^|\/)node_modules\//;

/**
 * Обход дерева документов от входов в ширину по относительным ссылкам внутри
 * корня. В обход идут существующие `.md`-цели, кроме `node_modules/` и
 * генерируемого — те читаются только ради якорей; цели не `.md` только
 * существуют. Корень — параметр: в проекте и в пакете-поставщике один класс.
 * @see src/cli/docs/docs-tree.test.ts
 */
export class DocsTree {
  constructor(
    private readonly root: string,
    private readonly settings: DocsSettings,
  ) {}

  async read(): Promise<DocsTreeRead> {
    const docs: MarkdownDoc[] = [];
    const targets = new Map<string, MarkdownDoc>();
    const missingEntries = this.settings.entries.filter(
      (entry) => !this.isFile(entry),
    );
    const queue = this.settings.entries.filter((entry) => this.isFile(entry));
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i] ?? '';
      const doc = await this.load(path);
      docs.push(doc);
      for (const { target } of doc.links()) {
        const next = DocLinks.resolve(path, target);
        if (seen.has(next) || next.startsWith('..')) continue;
        if (!next.endsWith('.md') || !this.isFile(next)) continue;
        seen.add(next);
        if (NODE_MODULES_RE.test(next) || this.settings.isGenerated(next)) {
          targets.set(next, await this.load(next));
        } else {
          queue.push(next);
        }
      }
    }
    return {
      docs,
      targets,
      exists: (path) => this.exists(path),
      missingEntries,
    };
  }

  /** Путь есть; с `/` на конце — только каталог */
  private exists(path: string): boolean {
    const stats = this.stat(path);
    return path.endsWith('/')
      ? stats?.isDirectory() === true
      : stats !== undefined;
  }

  private isFile(path: string): boolean {
    return this.stat(path)?.isFile() === true;
  }

  /** Сведения о пути; нет пути или часть пути — файл (`ENOTDIR`) — undefined */
  private stat(path: string): Stats | undefined {
    try {
      return statSync(join(this.root, path));
    } catch {
      return undefined;
    }
  }

  private async load(path: string): Promise<MarkdownDoc> {
    return new MarkdownDoc(path, await readFile(join(this.root, path), 'utf8'));
  }
}
