import type { CallerLog } from '#core/kernel/caller/caller';
import type { AggregateWrite } from '../uow/unit-of-work';
import type { OperationRecord, ValueDigest } from './operation-record';

/**
 * Лента лога операций для человека (D-86): строка на запись — время UTC,
 * вид, `модуль.операция`, кто, итог. С `aggregate` — под записью версии и
 * патч этого агрегата: `path: from → to`, `[скрыто]`, дайджест значения.
 * Порядок строк — порядок записей на входе.
 * @see src/app/oplog/operation-log-feed.test.ts
 */
export class OperationLogFeed {
  lines(
    records: readonly OperationRecord[],
    options: { readonly aggregate?: string } = {},
  ): string[] {
    const out: string[] = [];
    for (const record of records) {
      out.push(this.head(record));
      if (options.aggregate === undefined) continue;
      for (const write of record.writes) {
        if (write.uuid === options.aggregate) out.push(...this.patch(write));
      }
    }
    return out;
  }

  private head(r: OperationRecord): string {
    const time = new Date(r.at).toISOString().replace('T', ' ').slice(0, 23);
    return [
      time,
      r.kind,
      `${r.module}.${r.op}`,
      this.who(r.caller),
      this.outcome(r),
    ].join('  ');
  }

  private who(caller: CallerLog | undefined): string {
    if (caller === undefined || caller.kind === 'guest') return 'guest';
    if (caller.kind === 'user') return caller.subjectId;
    if (caller.kind === 'delegate') {
      const mode = caller.readOnly ? ', только чтение' : '';
      return `${caller.subjectId} (через ${caller.actorId}${mode})`;
    }
    const from = `system:${caller.from.module}.${caller.from.name}`;
    return caller.person ? `${from} за ${this.who(caller.person)}` : from;
  }

  private outcome(r: OperationRecord): string {
    return r.result?.ok === false ? `ошибка ${r.result.error.code}` : 'ok';
  }

  private patch(write: AggregateWrite): string[] {
    const out = [
      `  ${write.aggregate} ${write.uuid}: ${write.from ?? '—'} → ${write.to}`,
    ];
    for (const change of write.changes ?? []) {
      out.push(
        'redacted' in change
          ? `    ${change.path}: [скрыто]`
          : `    ${change.path}: ${this.value(change.from)} → ${this.value(change.to)}`,
      );
    }
    return out;
  }

  private value(value: unknown): string {
    if (value === undefined) return '—';
    if (this.isDigest(value)) {
      return `заменено, ${value.size} байт, ${value.hash}`;
    }
    return JSON.stringify(value);
  }

  private isDigest(value: unknown): value is ValueDigest {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Partial<ValueDigest>).digest === true
    );
  }
}
