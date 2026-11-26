import { ProjectConfig, ProjectConfigError } from '../gen/project-config';
import type { CliResult } from './dmg-core-cli';
import { DocsChecker } from './docs/docs-checker';
import { DocsSettings } from './docs/docs-settings';
import { DocsTree } from './docs/docs-tree';

/** Ошибка ввода `docs`: сообщение — пользователю, код 2. */
class DocsArgsError extends Error {}

/**
 * Команда `dmg-core docs --check`: проверка дерева документации проекта от
 * входов `docs.entries` (`docs-format.md` § 12). Корень — каталог запуска;
 * нет конфига — вход `llms.txt`. Нарушения — строки `DOC-NN: …` и итог,
 * `ok: false`; ошибка ввода — `usage: true`; отказ конфига — сообщение.
 * @see src/cli/main-docs.test.ts
 */
export class DocsCommand {
  constructor(private readonly root: string) {}

  async run(
    argv: readonly string[],
  ): Promise<CliResult & { readonly usage?: true }> {
    try {
      this.parse(argv);
      const config = await ProjectConfig.read(this.root);
      const settings = DocsSettings.of(config?.docs);
      const tree = await new DocsTree(this.root, settings).read();
      const violations = new DocsChecker(settings).check(tree);
      if (violations.length === 0) {
        return {
          ok: true,
          messages: [
            `docs --check: нарушений нет (документов — ${tree.docs.length})`,
          ],
        };
      }
      return {
        ok: false,
        messages: [
          ...violations.map((violation) => violation.format()),
          `docs --check: нарушений — ${violations.length}`,
        ],
      };
    } catch (error) {
      if (error instanceof DocsArgsError) {
        return { ok: false, usage: true, messages: [error.message] };
      }
      if (error instanceof ProjectConfigError) {
        return { ok: false, messages: [error.message] };
      }
      throw error;
    }
  }

  /** Ровно один аргумент — `--check` */
  private parse(argv: readonly string[]): void {
    for (const arg of argv) {
      if (arg === '--check') continue;
      throw new DocsArgsError(
        arg.startsWith('-')
          ? `docs: неизвестный флаг ${arg}`
          : `docs: лишний аргумент ${arg}`,
      );
    }
    if (argv.length !== 1) {
      throw new DocsArgsError(
        argv.length === 0 ? 'docs: нужен флаг --check' : 'docs: повтор --check',
      );
    }
  }
}
