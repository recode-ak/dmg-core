/** Правила `rules.md`, которые проверяет `arch:check`. */
export type ArchRule =
  | 'ARC-02'
  | 'ARC-04'
  | 'ARC-05'
  | 'ARC-06'
  | 'ARC-07'
  | 'ARC-08'
  | 'ARC-12'
  | 'ARC-13'
  | 'ARC-14'
  | 'ARC-15'
  | 'ARC-16'
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

/** Префиксы ID правил пакета; поставщику графа они не достаются (ARC-13). */
export const PACKAGE_RULE_PREFIXES = [
  'API',
  'ARC',
  'CODE',
  'DOM',
  'ERR',
  'MAN',
  'TST',
] as const;

/**
 * Нарушение, найденное `arch:check`: правила `rules.md` пакета (`ArchRule`)
 * или правила поставщика графа со своим ID (D-97). `file` — абсолютный путь
 * файла-импортёра у нарушений импорта по слоям: по нему нарушение
 * сопоставляется с записью долга (D-111).
 */
export class Violation {
  constructor(
    readonly rule: string,
    readonly message: string,
    readonly file?: string,
  ) {}

  /** Строка отчёта: начинается с ID правила. */
  format(): string {
    return `${this.rule}: ${this.message}`;
  }
}
