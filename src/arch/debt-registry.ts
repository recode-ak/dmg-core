// Разбор реестра долга (D-84, D-111): общий для учёта долга (`DebtChecker`) и
// отступлений от правил слоёв (`DeviationRegistry`). Внутри пакета, не из
// `dmg-core/arch`.
import type { DebtEntry } from './debt-checker.types';

const HEADING = /^#{1,3}\s/;
const ID_HEADING = /^###\s+((?:[A-Z]-)?DEBT-\d+)\b/;
const FIELD = /^- \*\*([^*]+):\*\*(.*)$/;
const SUB_ITEM = /^ {2}- (.*)$/;
const FENCE = /^\s*```/;
const TICK = /^`([^`]+)`\s*,?\s*/;
const LAST_ISSUED = /Последний выданный ID/;
/** ID в строке «Последний выданный ID»: префикс и номер. */
const LAST_ID = /Последний выданный ID:?\**:?\s*`?((?:[A-Z]-)?DEBT)-(\d+)/;

/**
 * Реестр долга одного вида: записи `### <prefix>-<n>` до следующего
 * заголовка вне блоков ```, дубли, чужой префикс, повторы полей, строка
 * «Последний выданный ID». Поле — токены в бэктиках подряд в начале строки
 * поля и пунктов первого уровня под ним до пустой строки.
 */
export class DebtRegistry {
  private constructor(
    private readonly prefix: string,
    private readonly lastIssued: string | undefined,
    readonly entries: ReadonlyMap<string, DebtEntry>,
    private readonly duplicates: readonly string[],
    private readonly foreign: readonly string[],
    private readonly repeated: readonly string[],
  ) {}

  static parse(md: string, prefix: string): DebtRegistry {
    const entries = new Map<string, DebtEntry>();
    const duplicates: string[] = [];
    const foreign: string[] = [];
    const repeated: string[] = [];
    let lastIssued: string | undefined;
    let entry: DebtEntry | undefined;
    let field: string[] | undefined;
    let fenced = false;
    for (const line of md.split('\n')) {
      if (FENCE.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      if (lastIssued === undefined && LAST_ISSUED.test(line)) lastIssued = line;
      if (!line.trim()) {
        field = undefined;
        continue;
      }
      if (HEADING.test(line)) {
        field = undefined;
        entry = undefined;
        const id = ID_HEADING.exec(line)?.[1];
        if (id === undefined) continue;
        if (!id.startsWith(`${prefix}-`)) {
          foreign.push(id);
        } else if (entries.has(id)) {
          duplicates.push(id);
        } else {
          entry = { id, fields: new Map() };
          entries.set(id, entry);
        }
        continue;
      }
      if (!entry) continue;
      const f = FIELD.exec(line);
      if (f) {
        const name = f[1] ?? '';
        field = DebtRegistry.leadingTicks(f[2] ?? '');
        // Повтор: значение первого поля остаётся, пункты повтора — в никуда.
        if (entry.fields.has(name))
          repeated.push(`${entry.id}: поле ${name} повторено`);
        else entry.fields.set(name, field);
        continue;
      }
      const item = SUB_ITEM.exec(line);
      if (item && field)
        field.push(...DebtRegistry.leadingTicks(item[1] ?? ''));
    }
    return new DebtRegistry(
      prefix,
      lastIssued,
      entries,
      duplicates,
      foreign,
      repeated,
    );
  }

  /** Токены в бэктиках подряд в начале текста (через запятую). */
  private static leadingTicks(text: string): string[] {
    const out: string[] = [];
    let rest = text.trimStart();
    for (let m = TICK.exec(rest); m; m = TICK.exec(rest)) {
      out.push(m[1] ?? '');
      rest = rest.slice(m[0].length);
    }
    return out;
  }

  /** Структура: чужой префикс, «Последний выданный ID», дубли, повторы полей. */
  checkHeadings(path: string): string[] {
    const out = this.foreign.map(
      (id) =>
        `${path}: заголовок ${id} — неверный префикс, нужен ${this.prefix}-<n>`,
    );
    const last =
      this.lastIssued === undefined ? undefined : LAST_ID.exec(this.lastIssued);
    if (!last) out.push(`${path}: нет строки «Последний выданный ID»`);
    else if (last[1] !== this.prefix)
      out.push(
        `${path}: «Последний выданный ID» ${last[1]}-${last[2]} — неверный префикс, нужен ${this.prefix}-<n>`,
      );
    else {
      const max = Math.max(
        0,
        ...[...this.entries.keys()].map((id) => this.numberOf(id)),
      );
      const issued = Number(last[2]);
      if (issued < max)
        out.push(
          `${path}: «Последний выданный ID» ${this.prefix}-${issued} меньше максимального ${this.prefix}-${max}`,
        );
    }
    out.push(...this.duplicates.map((id) => `${id}: дубль записи`));
    out.push(...this.repeated);
    return out;
  }

  private numberOf(id: string): number {
    return Number(id.slice(this.prefix.length + 1));
  }

  /** Обязательные поля записи и ровно одно из Погашает / Триггер. */
  static checkFields(e: DebtEntry, required: readonly string[]): string[] {
    const out = required
      .filter((name) => !e.fields.has(name))
      .map((name) => `${e.id}: нет поля ${name}`);
    const owner = e.fields.has('Погашает');
    const trigger = e.fields.has('Триггер');
    if (owner && trigger)
      out.push(`${e.id}: оба поля Погашает и Триггер — нужно одно`);
    if (!owner && !trigger) out.push(`${e.id}: нет поля Погашает или Триггер`);
    return out;
  }
}
