import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyOperationDef, DefIndex } from '../graph/def-index';
import { SourceScan } from './source-scan';
import { TODO_TEXT } from './todo-text';
import { type ArchRule, Violation } from './violation';

/** Текстовое поле Policy или правила в строке исходника: поле и литерал. */
const POLICY_TEXT =
  /\b(label|description|denyMessage)\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/;

/** Каталоги модуля: домен и пакет реализации. */
export type ModuleLayout = {
  readonly domain: string;
  readonly backend: string;
};

/**
 * Проверки по файлам модулей: файл модуля (ARC-06), файлы операций (MAN-06,
 * MAN-10), тексты Policy (MAN-01, предупреждения). У внешнего модуля
 * реализации в приложении нет (D-37) — проверяется только домен. Импорты
 * между слоями — `LayerChecker`.
 * @see src/arch/file-checker.test.ts
 */
export class FileChecker {
  private readonly scan = new SourceScan();

  constructor(
    private readonly index: DefIndex,
    private readonly layout: (module: string) => ModuleLayout,
  ) {}

  /**
   * Незаполненные тексты Policy (MAN-01, предупреждения): PolicyDef не входит
   * в граф Def, поэтому `label`/`description` политики и `label`/`denyMessage`
   * её правил ищутся в исходниках `*.policy.ts` домена — строковый литерал
   * поля, начинающийся со слова `TODO` (см. `DefChecker.todos`).
   */
  todos(): Violation[] {
    const out: Violation[] = [];
    for (const m of this.index.modules) {
      const base = this.layout(m.name).domain;
      for (const f of this.scan.files(base)) {
        if (!f.endsWith('.policy.ts')) continue;
        const lines = readFileSync(join(base, f), 'utf8').split('\n');
        lines.forEach((line, i) => {
          const found = POLICY_TEXT.exec(line);
          if (!found) return;
          const [, field, ...quoted] = found;
          const text = (quoted.find((q) => q !== undefined) ?? '').trim();
          if (!TODO_TEXT.test(text)) return;
          out.push(
            new Violation(
              'MAN-01',
              `политика ${m.name}/${f}:${i + 1}: ${field} не заполнен — «${text}»`,
            ),
          );
        });
      }
    }
    return out;
  }

  check(): Violation[] {
    const dirs = new Map(
      this.index.modules.map((m) => [m, this.layout(m.name)]),
    );
    const out: Violation[] = [];
    const add = (rule: ArchRule, message: string): void => {
      out.push(new Violation(rule, message));
    };

    for (const [m, dir] of dirs) {
      // Внешний модуль реализован вне приложения: прикладного пакета у него
      // нет, в домене — только контракт.
      const sides = m.external ? [dir.domain] : [dir.domain, dir.backend];
      for (const base of sides) {
        const file = join(base, `${m.name}.module.ts`);
        if (!existsSync(file)) add('ARC-06', `модуль ${m.name}: нет ${file}`);
      }

      const domainOps = this.operationFiles(dir.domain);
      if (!m.external) {
        const appOps = this.operationFiles(dir.backend);
        for (const f of appOps) {
          if (!domainOps.includes(f)) {
            add(
              'MAN-10',
              `${m.name}/${f} есть в прикладном слое, нет в домене`,
            );
          }
        }
        for (const f of domainOps) {
          if (!appOps.includes(f)) {
            add(
              'MAN-10',
              `${m.name}/${f} есть в домене, нет в прикладном слое`,
            );
          }
        }
      }

      const claimed = new Set<string>();
      for (const op of m.operations()) {
        const found = this.findOperationFile(op, domainOps);
        if (found.file === undefined) {
          add('MAN-10', `${op.title(m)}: ожидается файл ${found.expected}`);
        } else {
          claimed.add(found.file);
        }
      }
      for (const f of domainOps) {
        if (!claimed.has(f)) {
          add(
            'MAN-06',
            `${m.name}/${f} — нет такой операции в модуле (Def вне модуля)`,
          );
        }
      }
    }
    return out;
  }

  /**
   * Файл операции в домене: `<агрегат>/<uc|er|job>/<имя>.<вид>.ts`. Агрегат —
   * агрегат UC или основной (первый в `touches`/`scans`) у ER/Job; без него
   * подходит папка любого агрегата.
   */
  private findOperationFile(
    op: AnyOperationDef,
    files: readonly string[],
  ): { readonly file: string | undefined; readonly expected: string } {
    const kind = op.fileKind;
    const name = `${kind}/${this.kebab(op.name)}.${kind}.ts`;
    const main = op.mainAggregate();
    if (main === undefined) {
      const file = files.find((f) => f.endsWith(`/${name}`));
      return { file, expected: `<агрегат>/${name}` };
    }
    const expected = `${this.kebab(main.name)}/${name}`;
    return { file: files.includes(expected) ? expected : undefined, expected };
  }

  private operationFiles(base: string): string[] {
    return this.scan.files(base).filter((f) => /\.(uc|er|job)\.ts$/.test(f));
  }

  /** `archiveDoneTasks` → `archive-done-tasks`. */
  private kebab(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }
}
