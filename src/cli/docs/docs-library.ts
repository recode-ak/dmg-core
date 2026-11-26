import { realpath } from 'node:fs/promises';
import { ProviderPackage } from '../provider-package';
import { DocRegistries } from './doc-registries';
import { DocRegistry } from './doc-registry';
import type {
  DocSource,
  DocSourceRegistries,
  DocsLibraryInput,
} from './docs.types';
import { DocsSettings } from './docs-settings';
import { DocsTree } from './docs-tree';
import type { MarkdownDoc } from './markdown-doc';

/**
 * Реестры по источникам: проект (имя «проект») — из его документов, ядро
 * (`dmg-core`) и поставщики `providers` — каждый из дерева от своего
 * `llms.txt`, их конфиг не читается. Корень, совпавший по `realpath` с уже
 * прочитанным, пропускается: в репо пакета проект и ядро — один каталог.
 * Не установленный поставщик — `ProviderError`.
 * @see src/cli/docs/docs-library.test.ts
 */
export class DocsLibrary {
  private readonly sources: DocSourceRegistries[] = [];
  private readonly seen = new Set<string>();

  private constructor() {}

  static async load(input: DocsLibraryInput): Promise<DocRegistries> {
    const library = new DocsLibrary();
    await library.add(
      { name: 'проект', root: input.root, project: true },
      input.project,
    );
    await library.addPackage('dmg-core', input.coreRoot);
    for (const name of input.providers) {
      const { root } = await ProviderPackage.find(name, input.root);
      await library.addPackage(name, root);
    }
    return new DocRegistries(library.sources);
  }

  /** Пакет: документы — дерево от его `llms.txt`; повтор корня — пропуск */
  private async addPackage(name: string, root: string): Promise<void> {
    if (this.seen.has(await realpath(root))) return;
    const tree = await new DocsTree(root, DocsSettings.of()).read();
    await this.add({ name, root, project: false }, tree.docs);
  }

  private async add(
    source: DocSource,
    docs: readonly MarkdownDoc[],
  ): Promise<void> {
    this.seen.add(await realpath(source.root));
    this.sources.push({
      source,
      registries: docs.flatMap((doc) => DocRegistry.of(doc)),
    });
  }
}
