import type { DocReport } from './doc-report';
import type { DocArchive, DocLine, DocRecord } from './docs.types';
import { IdGrammar } from './id-grammar';
import type { MarkdownDoc } from './markdown-doc';

/** Префикс серии: части `[A-Z][A-Z0-9]*` через `-` */
const PREFIX = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*';
const SERIES_RE = /^\*\*Серия:\*\*(.*)$/;
const ARCHIVE_RE = /^\*\*Архив:\*\*(.*)$/;
const LAST_RE = /^\*\*Последний выданный ID:\*\*(.*)$/;
/** Строка, объявляющая реестр: место ей — шапка */
const DECLARATION_RE = /^\*\*(Серия|Архив):\*\*/;
/** Серия в строке «Серия» и архив-серия: `` `P-<n>` `` */
const SERIES_ITEM_RE = new RegExp(`^\`(${PREFIX})-<n>\`$`);
/** Архив-диапазон: `P-a…P-b`, в бэктиках или без */
const RANGE_RE = new RegExp(`^(\`?)(${PREFIX})-(\\d+)…(${PREFIX})-(\\d+)\\1$`);
/** Значение «Последнего выданного ID»: `P-N`, в бэктиках или без */
const LAST_VALUE_RE = new RegExp(`^(\`?)(${PREFIX})-(\\d+)\\1$`);
const SECTION_RE = /^##\s/;
/** Конец раздела `##`: следующий `#` или `##` */
const SECTION_END_RE = /^#{1,2}\s/;
/** Конец тела записи-заголовка: следующий `#`–`###` */
const RECORD_END_RE = /^#{1,3}\s/;
const HEADING_RE = /^###\s+(.*)$/;
/** После ID записи-заголовка: `. ` или `: ` и непустая суть */
const TITLE_RE = /^[.:]\s+(\S.*)$/;
const TABLE_ID_RE = /^\|\s*ID\s*\|/;
const TABLE_RULE_RE = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;
/** Ссылка на правило в сообщениях */
const RULE = 'docs-format.md § 6';

/**
 * Откуда реестр: реестр-файл (шапка — до первого `##`/`###`), раздел-реестр
 * (шапка — заголовок и первый абзац раздела) или строки «Серия»/«Архив» не
 * на месте в листе — серий и записей нет, есть только нарушения.
 */
type Form = 'file' | 'section' | 'stray';

/** Нарушение DOC-06 до отчёта: строка файла и суть */
type Issue = { readonly line: number; readonly text: string };

/**
 * Реестр по ID: реестр-файл или раздел `##`, открытый строкой «Серия»
 * (`docs-format.md` § 6): серии, архив, «Последний выданный ID», записи.
 * Записи — заголовки `### <ID>. <суть>` и строки таблиц с колонкой `ID`.
 * Строка «Серия» или «Архив» не на месте в листе — реестр без серий и
 * записей с нарушением DOC-06: иначе ошибка места молча выключает серию.
 * @see src/cli/docs/doc-registry.test.ts
 */
export class DocRegistry {
  /** Префиксы объявленных серий */
  readonly series: readonly string[];
  readonly archive: readonly DocArchive[];
  /** Префикс серии → последний выданный номер */
  readonly lastIssued: ReadonlyMap<string, number>;
  readonly records: readonly DocRecord[];
  /** Строка файла, объявившая реестр: первая «Серия» или «Архив» */
  readonly line: number;
  private readonly issues: Issue[] = [];
  /** Префикс → строка «Последнего выданного ID» */
  private readonly lastLines = new Map<string, number>();
  /** Грамматика записей: серии и архив-серии держателя */
  private readonly own: IdGrammar;

  private constructor(
    readonly path: string,
    lines: readonly DocLine[],
    headerSize: number,
    private readonly form: Form,
  ) {
    const header = lines.slice(0, headerSize).filter(({ code }) => !code);
    this.line =
      lines.find(({ text, code }) => !code && DECLARATION_RE.test(text))
        ?.line ?? 0;
    this.series = header.flatMap((line) => this.readSeries(line));
    this.archive = header.flatMap((line) => this.readArchive(line));
    this.lastIssued = this.readLastIssued(header);
    this.own = new IdGrammar([
      ...this.series,
      ...this.archive.map(({ prefix }) => prefix),
    ]);
    this.checkPlaces(lines.slice(headerSize));
    this.records =
      form === 'stray'
        ? []
        : [
            ...this.readHeadings(lines, headerSize),
            ...this.readRows(lines),
          ].sort((a, b) => a.line - b.line);
    this.checkRepeats();
    this.checkLastIssued();
  }

  /**
   * Реестр-файл и разделы-реестры документа; не реестр — пусто; лист со
   * строкой «Серия»/«Архив» не на месте — реестр без серий с нарушениями.
   */
  static of(doc: MarkdownDoc): DocRegistry[] {
    const lines = doc.lines();
    if (doc.isRegistry()) {
      return [new DocRegistry(doc.path, lines, doc.header().length, 'file')];
    }
    const registries: DocRegistry[] = [];
    const rest: DocLine[] = [];
    for (let start = 0; start < lines.length; ) {
      const end = DocRegistry.pieceEnd(lines, start);
      const piece = lines.slice(start, end);
      const header = DocRegistry.sectionHeader(piece);
      if (header > 0) {
        registries.push(new DocRegistry(doc.path, piece, header, 'section'));
      } else {
        rest.push(...piece);
      }
      start = end;
    }
    const stray = rest.some(
      ({ text, code }) => !code && DECLARATION_RE.test(text),
    );
    if (stray) registries.push(new DocRegistry(doc.path, rest, 0, 'stray'));
    return registries;
  }

  /** DOC-06 внутри реестра: форма шапки и записей, повтор ID, «Последний выданный ID» */
  report(into: DocReport): void {
    for (const { line, text } of this.issues) {
      into.add('DOC-06', this.path, line, text);
    }
  }

  /**
   * Конец куска листа от `start`: у раздела `##` — до следующего `#` или
   * `##` вне кода, у текста до раздела — до ближайшего `##`.
   */
  private static pieceEnd(lines: readonly DocLine[], start: number): number {
    const first = lines[start];
    const end =
      first !== undefined && DocRegistry.isSection(first)
        ? SECTION_END_RE
        : SECTION_RE;
    for (let i = start + 1; i < lines.length; i++) {
      const { text, code } = lines[i] as DocLine;
      if (!code && end.test(text)) return i;
    }
    return lines.length;
  }

  private static isSection({ text, code }: DocLine): boolean {
    return !code && SECTION_RE.test(text);
  }

  /**
   * Размер шапки раздела-реестра: заголовок `##` и первый абзац, который
   * начинается строкой «Серия» или «Архив»; не раздел-реестр — 0.
   */
  private static sectionHeader(piece: readonly DocLine[]): number {
    const [heading] = piece;
    if (heading === undefined || !DocRegistry.isSection(heading)) return 0;
    let i = 1;
    while (piece[i]?.text.trim() === '') i++;
    const first = piece[i];
    if (!first || first.code || !DECLARATION_RE.test(first.text)) return 0;
    while (i < piece.length && piece[i]?.text.trim() !== '') i++;
    return i;
  }

  /** Префиксы строки «Серия»: `` `P-<n>` `` через запятую */
  private readSeries({ text, line }: DocLine): string[] {
    const value = SERIES_RE.exec(text)?.[1];
    if (value === undefined) return [];
    const prefixes = value
      .split(',')
      .map((item) => SERIES_ITEM_RE.exec(item.trim())?.[1]);
    if (value.trim() !== '' && prefixes.every((p) => p !== undefined)) {
      return prefixes as string[];
    }
    this.issue(
      line,
      `строка «Серия» не по форме: **Серия:** \`P-<n>\`, \`Q-<n>\` (${RULE})`,
    );
    return [];
  }

  /** «Архив»: диапазон своей серии `P-a…P-b` или чужая серия `` `P-<n>` `` */
  private readArchive({ text, line }: DocLine): DocArchive[] {
    const value = ARCHIVE_RE.exec(text)?.[1]?.trim();
    if (value === undefined) return [];
    const series = SERIES_ITEM_RE.exec(value)?.[1];
    if (series !== undefined) return [{ kind: 'series', prefix: series }];
    const range = RANGE_RE.exec(value);
    const prefix = range?.[2];
    if (!range || prefix === undefined || prefix !== range[4]) {
      this.issue(
        line,
        `строка «Архив» не по форме: диапазон P-a…P-b своей серии или серия \`P-<n>\` (${RULE})`,
      );
      return [];
    }
    if (!this.series.includes(prefix)) {
      this.issue(
        line,
        `диапазон архива ${prefix} — у владельца серии: объяви ${prefix} в «Серии» этого реестра или пиши архив серией \`${prefix}-<n>\` (${RULE})`,
      );
      return [];
    }
    return [
      { kind: 'range', prefix, from: Number(range[3]), to: Number(range[5]) },
    ];
  }

  /** «Последний выданный ID» своих серий, по строке на серию */
  private readLastIssued(header: readonly DocLine[]): Map<string, number> {
    const last = new Map<string, number>();
    for (const { text, line } of header) {
      const value = LAST_RE.exec(text)?.[1]?.trim();
      if (value === undefined) continue;
      const match = LAST_VALUE_RE.exec(value);
      const prefix = match?.[2];
      if (!match || prefix === undefined) {
        this.issue(
          line,
          `«Последний выданный ID» не по форме: **Последний выданный ID:** P-N (${RULE})`,
        );
      } else if (!this.series.includes(prefix)) {
        this.issue(
          line,
          `«Последний выданный ID» чужой серии ${prefix}: только серии этого реестра (${RULE})`,
        );
      } else if (last.has(prefix)) {
        this.issue(
          line,
          `второй «Последний выданный ID» серии ${prefix}: оставь одну строку (${RULE})`,
        );
      } else {
        last.set(prefix, Number(match[3]));
        this.lastLines.set(prefix, line);
      }
    }
    return last;
  }

  /** Строка «Серия» или «Архив» после шапки — не на месте */
  private checkPlaces(lines: readonly DocLine[]): void {
    for (const { text, line, code } of lines) {
      const name = code ? undefined : DECLARATION_RE.exec(text)?.[1];
      if (name === undefined) continue;
      this.issue(
        line,
        `строка «${name}» не на месте: только в шапке реестра-файла или первой строкой раздела ## (${RULE})`,
      );
    }
  }

  /**
   * Записи-заголовки `###` после шапки. В реестре-файле `###` не по форме —
   * DOC-06; в разделе-реестре `###` без своего ID в начале — подзаголовок
   * листа, не запись и не ошибка.
   */
  private readHeadings(
    lines: readonly DocLine[],
    headerSize: number,
  ): DocRecord[] {
    const records: DocRecord[] = [];
    for (let i = headerSize; i < lines.length; i++) {
      const { text, line, code } = lines[i] as DocLine;
      const heading = code ? undefined : HEADING_RE.exec(text)?.[1];
      if (heading === undefined) continue;
      const [mention] = this.own.find(heading);
      if (mention?.index !== 0) {
        if (this.form === 'file') {
          this.issue(
            line,
            `заголовок ### реестра без ID его серии: ### P-N. Суть (${RULE})`,
          );
        }
        continue;
      }
      const title = TITLE_RE.exec(heading.slice(mention.id.length))?.[1];
      if (title === undefined) {
        this.issue(
          line,
          `запись ${mention.id} не по форме: после ID «. » или «: » и непустая суть (${RULE})`,
        );
        continue;
      }
      records.push({
        id: mention.id,
        prefix: mention.prefix,
        number: mention.number,
        title: title.trim(),
        text: this.body(lines, i),
        path: this.path,
        line,
        form: 'heading',
      });
    }
    return records;
  }

  /** Текст записи-заголовка: до следующего `#`–`###` вне кода, без хвостовых `---` и пустых строк */
  private body(lines: readonly DocLine[], start: number): string {
    let end = start + 1;
    while (end < lines.length) {
      const { text, code } = lines[end] as DocLine;
      if (!code && RECORD_END_RE.test(text)) break;
      end++;
    }
    const texts = lines.slice(start, end).map(({ text }) => text);
    while (texts.length > 1) {
      const tail = (texts[texts.length - 1] ?? '').trim();
      if (tail !== '' && tail !== '---') break;
      texts.pop();
    }
    return texts.join('\n');
  }

  /** Записи-строки: таблицы, у которых первая ячейка шапки — ровно `ID` */
  private readRows(lines: readonly DocLine[]): DocRecord[] {
    const records: DocRecord[] = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const head = lines[i] as DocLine;
      const rule = lines[i + 1] as DocLine;
      if (head.code || rule.code || !TABLE_ID_RE.test(head.text)) continue;
      if (!TABLE_RULE_RE.test(rule.text)) continue;
      let j = i + 2;
      for (; j < lines.length; j++) {
        const row = lines[j] as DocLine;
        if (row.code || !row.text.startsWith('|')) break;
        const record = this.row(head.text, rule.text, row);
        if (record) records.push(record);
      }
      i = j - 1;
    }
    return records;
  }

  /** Запись-строка: первая ячейка — ID серии реестра; иначе DOC-06 */
  private row(head: string, rule: string, row: DocLine): DocRecord | undefined {
    const cell = (row.text.split('|')[1] ?? '').trim();
    const [mention] = this.own.find(cell);
    if (mention?.id !== cell) {
      this.issue(
        row.line,
        `строка таблицы ID без ID серии реестра: первая ячейка — P-N (${RULE})`,
      );
      return undefined;
    }
    return {
      id: mention.id,
      prefix: mention.prefix,
      number: mention.number,
      title: row.text,
      text: [head, rule, row.text].join('\n'),
      path: this.path,
      line: row.line,
      form: 'row',
    };
  }

  /** Один ID — одна запись; номер числом: `D-01` и `D-1` — один ID */
  private checkRepeats(): void {
    const first = new Map<string, DocRecord>();
    for (const record of this.records) {
      const key = `${record.prefix}-${record.number}`;
      const earlier = first.get(key);
      if (earlier === undefined) {
        first.set(key, record);
        continue;
      }
      this.issue(
        record.line,
        `повтор ID ${record.id}: запись ${earlier.id} уже на строке ${earlier.line} — ID одна запись (${RULE})`,
      );
    }
  }

  /** «Последний выданный ID» не меньше максимума записей своей серии */
  private checkLastIssued(): void {
    for (const [prefix, last] of this.lastIssued) {
      const max = Math.max(
        0,
        ...this.records
          .filter((record) => record.prefix === prefix)
          .map((record) => record.number),
      );
      if (last >= max) continue;
      this.issue(
        this.lastLines.get(prefix) ?? this.line,
        `«Последний выданный ID» ${prefix}-${last} меньше записи ${prefix}-${max}: подними до ${prefix}-${max} (${RULE})`,
      );
    }
  }

  private issue(line: number, text: string): void {
    this.issues.push({ line, text });
  }
}
