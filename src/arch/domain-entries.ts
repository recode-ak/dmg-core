import type { EntryMisuse } from './domain-entries.types';
import { SourceScan } from './source-scan';

/**
 * Входы модуля домена для чужого кода (D-70): `entry` — всем, `testing` —
 * фикстуры владельца, только тестовому коду. Общие для `FileChecker` и
 * `AssemblyChecker`.
 */
export class DomainEntries {
  private readonly scan = new SourceScan();

  constructor(
    readonly entry: string,
    readonly testing: string,
  ) {}

  /**
   * Почему импорт `target` из каталога домена `dir` модуля `name` запрещён
   * файлу `file` (путь через `/` от каталога его слоя), или `undefined`.
   */
  misuse(
    file: string,
    target: string,
    dir: string,
    name: string,
  ): EntryMisuse | undefined {
    if (this.scan.isEntry(target, dir, this.entry)) return undefined;
    if (!this.scan.isEntry(target, dir, this.testing)) {
      return {
        testing: false,
        message: `импортирует ${name} мимо ${this.entry}.ts`,
      };
    }
    if (this.scan.isTest(file, this.testing)) return undefined;
    return {
      testing: true,
      message: `импортирует ${this.testing}.ts модуля ${name} — вход только для тестового кода`,
    };
  }
}
