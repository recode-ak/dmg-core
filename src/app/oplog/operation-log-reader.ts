import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CallerLog } from '#core/kernel/caller/caller';
import { OPLOG_DAY_FILE } from './jsonl-operation-log';
import type { OperationRecord } from './operation-record';

/**
 * Фильтр чтения лога операций; поля комбинируются по И. `since`/`until` —
 * день `YYYY-MM-DD` (граница дня UTC включительно) или ISO-время (точно).
 */
export type OperationLogFilter = {
  /** Цепочка запроса: `trace.correlationId`. */
  readonly request?: string;
  /** Записи, в `writes` которых есть агрегат с этим `uuid`. */
  readonly aggregate?: string;
  /** Субъект `caller`; у system — субъект `person`. */
  readonly subject?: string;
  readonly module?: string;
  readonly op?: string;
  /** Только записи с ошибкой в итоге. */
  readonly failed?: boolean;
  readonly since?: string;
  readonly until?: string;
};

/** Неверное значение фильтра (дата `since`/`until`) — ошибка ввода. */
export class OperationLogFilterError extends Error {}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;
const KINDS: readonly string[] = ['useCase', 'eventReaction', 'job', 'app'];
const DAY_MS = 86_400_000;

/** Диапазон `at` фильтра, мс, включительно. */
class TimeRange {
  readonly from: number;
  readonly to: number;

  constructor(since: string | undefined, until: string | undefined) {
    this.from = since === undefined ? -Infinity : this.parse(since, 0);
    this.to = until === undefined ? Infinity : this.parse(until, DAY_MS - 1);
  }

  contains(at: number): boolean {
    return at >= this.from && at <= this.to;
  }

  /** Файл дня пересекается с диапазоном. */
  overlapsDay(day: string): boolean {
    const start = Date.parse(day);
    return start + DAY_MS - 1 >= this.from && start <= this.to;
  }

  /**
   * `dayOffset` — сдвиг от начала дня для даты без времени. Время без
   * смещения — UTC: граница не зависит от пояса процесса.
   */
  private parse(value: string, dayOffset: number): number {
    const time = TIME.exec(value);
    const day = time?.[1] ?? value;
    const start = this.dayStart(day);
    if (start !== undefined && !time) return start + dayOffset;
    const ms = time ? Date.parse(time[2] ? value : `${value}Z`) : Number.NaN;
    if (start === undefined || Number.isNaN(ms)) {
      throw new OperationLogFilterError(
        `Неверная дата: ${value} (YYYY-MM-DD или ISO-время)`,
      );
    }
    return ms;
  }

  /** Начало существующего дня UTC; `2026-02-30` — нет. */
  private dayStart(day: string): number | undefined {
    const m = DAY.exec(day);
    if (!m) return undefined;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(ms).toISOString().slice(0, 10) === day ? ms : undefined;
  }
}

/**
 * Чтение каталога лога операций `JsonlOperationLog` (D-85): файлы дней вне
 * диапазона `since`/`until` не открываются, битая строка или без `at`, `module`,
 * `op`, `kind` — пропуск и `warn` (файл и номер строки). Запись старого формата без `writes` — с пустым.
 * @see src/app/oplog/operation-log-reader.test.ts
 */
export class OperationLogReader {
  constructor(
    private readonly dir: string,
    private readonly warn: (message: string) => void = console.warn,
  ) {}

  /** Записи по фильтру по возрастанию `at`. */
  async read(filter: OperationLogFilter): Promise<OperationRecord[]> {
    const range = new TimeRange(filter.since, filter.until);
    const out: OperationRecord[] = [];
    for (const name of await this.files(range)) {
      for (const record of await this.parse(name)) {
        if (range.contains(record.at) && this.matches(record, filter)) {
          out.push(record);
        }
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  private async files(range: TimeRange): Promise<string[]> {
    const names = await readdir(this.dir);
    return names
      .filter((name) => {
        const day = OPLOG_DAY_FILE.exec(name)?.[1];
        return day !== undefined && range.overlapsDay(day);
      })
      .sort();
  }

  private async parse(name: string): Promise<OperationRecord[]> {
    const text = await readFile(join(this.dir, name), 'utf8');
    const out: OperationRecord[] = [];
    text.split('\n').forEach((line, index) => {
      if (line.trim() === '') return;
      const record = this.record(line);
      if (record) out.push(record);
      else this.warn(`${name}:${index + 1}: битая строка лога, пропущена`);
    });
    return out;
  }

  private record(line: string): OperationRecord | undefined {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (typeof value !== 'object' || value === null) return undefined;
    const raw = value as Partial<OperationRecord>;
    if (
      typeof raw.at !== 'number' ||
      typeof raw.module !== 'string' ||
      typeof raw.op !== 'string' ||
      typeof raw.kind !== 'string' ||
      !KINDS.includes(raw.kind)
    ) {
      return undefined;
    }
    return { ...raw, writes: raw.writes ?? [] } as OperationRecord;
  }

  private matches(r: OperationRecord, f: OperationLogFilter): boolean {
    if (f.request !== undefined && r.trace?.correlationId !== f.request) {
      return false;
    }
    if (
      f.aggregate !== undefined &&
      !r.writes.some((w) => w.uuid === f.aggregate)
    ) {
      return false;
    }
    if (f.subject !== undefined && this.subject(r.caller) !== f.subject) {
      return false;
    }
    if (f.module !== undefined && r.module !== f.module) return false;
    if (f.op !== undefined && r.op !== f.op) return false;
    if (f.failed && r.result?.ok !== false) return false;
    return true;
  }

  private subject(caller: CallerLog | undefined): string | undefined {
    if (caller === undefined || caller.kind === 'guest') return undefined;
    if (caller.kind === 'system') return this.subject(caller.person);
    return caller.subjectId;
  }
}
