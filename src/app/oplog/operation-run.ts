import type { Caller, OperationRef } from '#core/kernel/caller/caller';
import type { DomainError } from '#core/kernel/errors/error';
import type { Result } from '#core/kernel/result/result';
import type { Timestamp } from '#core/kernel/time/timestamp';
import type { Trace } from '#core/kernel/trace/trace';
import type { UnitOfWork } from '../uow/unit-of-work';
import type { OperationRecord } from './operation-record';
import type { RecordMask } from './record-mask';

/** Кто и с чем вызвал операцию — постоянная часть записи лога. */
export type OperationCall = {
  readonly input: unknown;
  readonly caller: Caller;
  readonly trace: Trace;
};

/** Как писать выход в запись: целиком или сводкой размера (query, D-73). */
export type OutputMode = 'full' | 'size';

/**
 * Один вызов операции для лога (D-43, Р6; D-73): момент начала, длительность
 * и UoW вызова (у Job — по одной на запись). События и записи агрегатов —
 * всех UoW, в том числе до сбоя фиксации.
 */
export class OperationRun {
  private readonly uows: UnitOfWork[] = [];
  private readonly started = performance.now();
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly ref: OperationRef,
    private readonly at: Timestamp,
    private readonly call: OperationCall,
    private readonly output: OutputMode = 'full',
    private readonly mask?: RecordMask,
  ) {}

  /** UoW вызова — её события попадут в запись. */
  track(uow: UnitOfWork): UnitOfWork {
    this.uows.push(uow);
    return uow;
  }

  /**
   * Запись по итогу вызова; `undefined` в выходе — `null` (JSON). Маска —
   * единственное место маскирования записи; сводка query считается
   * по немаскированному выходу.
   */
  record(result: Result<unknown, DomainError>): OperationRecord {
    const { ref, at, call } = this;
    const record: OperationRecord = {
      at,
      module: ref.module,
      op: ref.name,
      kind: ref.kind,
      caller: call.caller.toLog(),
      trace: call.trace.toLog(),
      input: call.input ?? null,
      result: result.ok
        ? this.success(result.value ?? null)
        : { ok: false, error: result.error },
      events: this.uows.flatMap((uow) => uow.published),
      writes: this.uows.flatMap((uow) => uow.writes),
      durationMs: Math.round((performance.now() - this.started) * 10) / 10,
    };
    return this.mask === undefined ? record : this.mask.apply(record);
  }

  private success(value: unknown): OperationRecord['result'] {
    if (this.output === 'full') return { ok: true, output: value };
    const size = this.encoder.encode(JSON.stringify(value)).length;
    return { ok: true, size };
  }
}
