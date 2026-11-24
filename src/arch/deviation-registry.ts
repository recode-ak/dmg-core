import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { DebtEntry } from './debt-checker.types';
import { DebtRegistry } from './debt-registry';
import type { ArchDebt, DeviationInput } from './deviation-registry.types';
import { SourceScan } from './source-scan';
import { Violation } from './violation';

/** Префикс ID долга кода: пакет — `DEBT`, проект — `<X>-DEBT`. */
const ID_PREFIX = /^(?:[A-Z]-)?DEBT$/;

/**
 * Отступления от правил слоёв поставщика записями долга кода (D-111, ARC-12):
 * запись с полем Правило снимает нарушение с этим ID в файле из Места, если
 * доступ разрешает отступление (`debt`). Запись сверяет приложение, в чьих
 * файлах находит Место. Чистое сопоставление над памятью; диск — `read`.
 * @see src/arch/deviation-registry.test.ts
 */
export class DeviationRegistry {
  private readonly entries: readonly DebtEntry[];
  /** Пути файлов проекта от корня Места через `/`. */
  private readonly files: readonly string[];

  constructor(private readonly input: DeviationInput) {
    const registry = DebtRegistry.parse(input.md, input.idPrefix);
    this.entries = [...registry.entries.values()].filter((e) =>
      e.fields.has('Правило'),
    );
    this.files = input.files.map((file) => this.rel(file));
  }

  /** Реестр и `.ts`-файлы проекта с диска; неверный вход — исключение. */
  static read(debt: ArchDebt, project: string): DeviationRegistry {
    if (!ID_PREFIX.test(debt.idPrefix)) {
      throw new Error(
        `ArchApp.debt.idPrefix — DEBT или <X>-DEBT: ${debt.idPrefix}`,
      );
    }
    const root = resolve(debt.root);
    const dir = resolve(project);
    const scan = new SourceScan();
    if (!scan.inside(dir, root)) {
      throw new Error(`ArchApp.debt.root — ArchApp.project вне корня: ${dir}`);
    }
    const path = resolve(root, debt.code);
    if (!existsSync(path)) {
      throw new Error(`ArchApp.debt — нет реестра: ${path}`);
    }
    return new DeviationRegistry({
      md: readFileSync(path, 'utf8'),
      idPrefix: debt.idPrefix,
      root,
      files: scan.projectFiles(dir).map((file) => join(dir, file)),
    });
  }

  /**
   * Нарушения без снятых — в исходном порядке, затем ARC-12 по записям:
   * Правило без ID, ID без разрешения, glob Места, ничего не снявший.
   */
  apply(
    violations: readonly Violation[],
    debtIds: ReadonlySet<string>,
  ): Violation[] {
    const removed = new Set<Violation>();
    const lines = this.entries.flatMap((entry) =>
      this.match(entry, violations, debtIds, removed).map(
        (message) => new Violation('ARC-12', `${entry.id}: ${message}`),
      ),
    );
    return [...violations.filter((v) => !removed.has(v)), ...lines];
  }

  // Glob Места, не нашедший файлов проекта, — glob другого приложения с тем же
  // реестром: такой не сверяется, а запись без своих glob'ов молчит целиком.
  private match(
    entry: DebtEntry,
    violations: readonly Violation[],
    debtIds: ReadonlySet<string>,
    removed: Set<Violation>,
  ): string[] {
    const places = (entry.fields.get('Место') ?? []).filter((place) => {
      const glob = new Bun.Glob(place);
      return this.files.some((file) => glob.match(file));
    });
    if (places.length === 0) return [];
    const ids = entry.fields.get('Правило') ?? [];
    if (ids.length === 0) return ['поле Правило без ID'];
    const out = ids
      .filter((id) => !debtIds.has(id))
      .map(
        (id) => `правило ${id} отступления не допускает — нарушение остаётся`,
      );
    const allowed = ids.filter((id) => debtIds.has(id));
    if (allowed.length === 0) return out;
    for (const place of places) {
      const glob = new Bun.Glob(place);
      const found = violations.filter(
        (v) =>
          allowed.includes(v.rule) &&
          v.file !== undefined &&
          glob.match(this.rel(v.file)),
      );
      for (const v of found) removed.add(v);
      if (found.length === 0) {
        out.push(
          `отступление ${allowed.join(', ')} не нашло нарушения (\`${place}\`) — сними glob или закрой запись`,
        );
      }
    }
    return out;
  }

  private rel(path: string): string {
    return relative(this.input.root, path).split(sep).join('/');
  }
}
