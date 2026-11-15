/** Правила `rules.md`, которые проверяет `arch:check`. */
export type ArchRule =
  | 'ARC-04'
  | 'ARC-05'
  | 'ARC-06'
  | 'ARC-07'
  | 'ARC-08'
  | 'ARC-12'
  | 'DOM-16'
  | 'ERR-02'
  | 'ERR-04'
  | 'MAN-01'
  | 'MAN-02'
  | 'MAN-03'
  | 'MAN-05'
  | 'MAN-06'
  | 'MAN-08'
  | 'MAN-10'
  | 'MAN-12'
  | 'MAN-13'
  | 'MAN-14'
  | 'MAN-15'
  | 'MAN-16'
  | 'TST-07';

/** Нарушение правила `rules.md`, найденное `arch:check`. */
export class Violation {
  constructor(
    readonly rule: ArchRule,
    readonly message: string,
  ) {}

  /** Строка отчёта: начинается с ID правила. */
  format(): string {
    return `${this.rule}: ${this.message}`;
  }
}
