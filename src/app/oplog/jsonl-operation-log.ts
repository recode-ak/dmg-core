import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AggregateWrite } from '../uow/unit-of-work';
import type {
  OperationLog,
  OperationRecord,
  ValueDigest,
} from './operation-record';

/** Порог размера `input`, `output` и `payload` ошибки записи по умолчанию — ≈8 КБ. */
export const DEFAULT_OPLOG_MAX_BYTES = 8 * 1024;

/** Порог размера `from`/`to` изменения в патче записи по умолчанию — 1 КБ. */
export const DEFAULT_OPLOG_VALUE_MAX_BYTES = 1024;

/** Обрезанное значение: размер исходного JSON и его начало. */
export type TruncatedValue = {
  readonly truncated: true;
  readonly bytes: number;
  readonly head: string;
};

/**
 * Порог размера значения в записи: JSON длиннее `maxBytes` (UTF-8)
 * заменяется пометкой с размером и началом строки, не длиннее порога.
 */
class SizeLimit {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly maxBytes: number) {}

  apply(value: unknown): unknown {
    if (value === undefined) return value;
    const json = JSON.stringify(value);
    const bytes = this.encoder.encode(json);
    if (bytes.length <= this.maxBytes) return value;
    // Срез по байтам может разрезать символ — неполный хвост отбрасывается.
    const head = this.decoder
      .decode(bytes.subarray(0, this.maxBytes))
      .replace(/�+$/, '');
    const truncated: TruncatedValue = {
      truncated: true,
      bytes: bytes.length,
      head,
    };
    return truncated;
  }
}

/**
 * Порог значения в патче записи: JSON длиннее `maxBytes` (UTF-8)
 * заменяется дайджестом — размер и начало sha256, без содержимого.
 */
class ValueLimit {
  private readonly encoder = new TextEncoder();

  constructor(private readonly maxBytes: number) {}

  apply(value: unknown): unknown {
    if (value === undefined) return value;
    const json = JSON.stringify(value);
    const size = this.encoder.encode(json).length;
    if (size <= this.maxBytes) return value;
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 12);
    const digest: ValueDigest = { digest: true, size, hash };
    return digest;
  }
}

/**
 * Лог операций в JSONL: файл на день (`YYYY-MM-DD.jsonl`, UTC по `at`),
 * строка на запись. Каталог создаётся при первой записи; записи идут
 * по очереди — строки параллельных операций не перемешиваются.
 * `input`, `output` и `payload` ошибки больше порога обрезаются с пометкой
 * (`TruncatedValue`); `events` и `writes` — короткие ссылки, без порога,
 * кроме `from`/`to` изменений патча: больше `valueMaxBytes` — `ValueDigest`.
 * @see src/app/oplog/jsonl-operation-log.test.ts
 */
export class JsonlOperationLog implements OperationLog {
  private readonly limit: SizeLimit;
  private readonly valueLimit: ValueLimit;
  private queue: Promise<void> = Promise.resolve();
  private ready: Promise<unknown> | undefined;

  constructor(
    private readonly dir: string,
    options: {
      readonly maxBytes?: number;
      readonly valueMaxBytes?: number;
    } = {},
  ) {
    this.limit = new SizeLimit(options.maxBytes ?? DEFAULT_OPLOG_MAX_BYTES);
    this.valueLimit = new ValueLimit(
      options.valueMaxBytes ?? DEFAULT_OPLOG_VALUE_MAX_BYTES,
    );
  }

  append(record: OperationRecord): Promise<void> {
    const line = `${JSON.stringify(this.limited(record))}\n`;
    const file = join(this.dir, `${this.day(record)}.jsonl`);
    const next = this.queue.then(async () => {
      this.ready ??= mkdir(this.dir, { recursive: true }).catch((error) => {
        this.ready = undefined;
        throw error;
      });
      await this.ready;
      await appendFile(file, line, 'utf8');
    });
    // Сбой одной записи не должен блокировать следующие.
    this.queue = next.catch(() => {});
    return next;
  }

  private limited(record: OperationRecord): OperationRecord {
    return {
      ...record,
      input: this.limit.apply(record.input),
      result: this.limitedResult(record.result),
      writes: record.writes.map((write) => this.limitedWrite(write)),
    };
  }

  /** `redacted` значений не несёт — остаётся как есть. */
  private limitedWrite(write: AggregateWrite): AggregateWrite {
    if (write.changes === undefined) return write;
    const changes = write.changes.map((change) =>
      'redacted' in change
        ? change
        : {
            ...change,
            from: this.valueLimit.apply(change.from),
            to: this.valueLimit.apply(change.to),
          },
    );
    return { ...write, changes };
  }

  private limitedResult(
    result: OperationRecord['result'],
  ): OperationRecord['result'] {
    if (!result.ok) {
      const { error } = result;
      return {
        ok: false,
        error: { ...error, payload: this.limit.apply(error.payload) },
      };
    }
    if ('output' in result) {
      return { ok: true, output: this.limit.apply(result.output) };
    }
    return result;
  }

  private day(record: OperationRecord): string {
    return new Date(record.at).toISOString().slice(0, 10);
  }
}
