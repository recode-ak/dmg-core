import { Violation } from '../../arch/violation';

/** Нарушение до сортировки: путь и строка — ключи порядка отчёта */
type Row = {
  readonly path: string;
  readonly line: number;
  readonly violation: Violation;
};

/**
 * Отчёт `docs --check`: строки `DOC-NN: путь[:строка] — суть: как исправить`
 * (`docs-format.md` § 12), по пути и номеру строки; нарушение файла целиком —
 * раньше строк этого файла.
 */
export class DocReport {
  private readonly rows: Row[] = [];

  add(rule: string, path: string, line: number | undefined, text: string) {
    const place = line === undefined ? path : `${path}:${line}`;
    this.rows.push({
      path,
      line: line ?? 0,
      violation: new Violation(rule, `${place} — ${text}`),
    });
  }

  violations(): Violation[] {
    return [...this.rows]
      .sort((a, b) =>
        a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1,
      )
      .map((row) => row.violation);
  }
}
