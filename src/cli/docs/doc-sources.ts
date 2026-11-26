import { join } from 'node:path';
import type { SourceFile } from '../../arch/debt-checker.types';
import { SourceWalk } from '../../arch/source-walk';
import type { DocsSettings } from './docs-settings';

/** Тестовый код D-70: тесты, фикстуры, наборы помощников тестов */
const TEST_CODE_RE = /\.(?:test|fixture|test-kit)\.ts$/;

/**
 * Исходники `*.ts` проекта для DOC-07: от корня, без тестового кода,
 * генерируемого (`docs.generated`) и каталогов, которые не обходит `SourceWalk`.
 * @see src/cli/docs/doc-sources.test.ts
 */
export class DocSources {
  constructor(
    private readonly root: string,
    private readonly settings: DocsSettings,
  ) {}

  /** Файлы по алфавиту пути; путь от корня через `/` */
  async read(): Promise<SourceFile[]> {
    const paths = new SourceWalk(this.root)
      .paths()
      .filter(
        (path) =>
          path.endsWith('.ts') &&
          !TEST_CODE_RE.test(path) &&
          !this.settings.isGenerated(path),
      )
      .sort();
    return Promise.all(
      paths.map(async (path) => ({
        path,
        text: await Bun.file(join(this.root, path)).text(),
      })),
    );
  }
}
