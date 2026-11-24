import { isBuiltin } from 'node:module';

/** Вид спецификатора: путь, встроенный модуль рантайма, `imports` своего пакета, пакет. */
type SpecifierKind = 'path' | 'runtime' | 'subpath' | 'package';

/**
 * Спецификатор импорта для ARC-14/15 (D-108): вид и имя пакета без подпути.
 * Встроенные — по `isBuiltin` рантайма Bun (в нём и `ws`, `undici`), плюс
 * `node:*`, `bun`, `bun:*`. Собственное имя единицы классу неизвестно — пакет.
 * @see src/arch/import-specifier.test.ts
 */
export class ImportSpecifier {
  readonly kind: SpecifierKind;
  /** Только у `package`: `name` или `@scope/name`. */
  readonly packageName?: string;

  constructor(readonly spec: string) {
    this.kind = this.classify();
    if (this.kind === 'package') this.packageName = this.nameOf();
  }

  private classify(): SpecifierKind {
    const { spec } = this;
    if (
      spec === '.' ||
      spec === '..' ||
      spec.startsWith('./') ||
      spec.startsWith('../') ||
      spec.startsWith('/')
    ) {
      return 'path';
    }
    if (spec.startsWith('#')) return 'subpath';
    if (
      spec.startsWith('node:') ||
      spec === 'bun' ||
      spec.startsWith('bun:') ||
      isBuiltin(spec)
    ) {
      return 'runtime';
    }
    return 'package';
  }

  private nameOf(): string {
    const parts = this.spec.split('/');
    return (
      this.spec.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)
    ).join('/');
  }
}
