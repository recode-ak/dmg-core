import type * as v from 'valibot';
import type { AnyAggregateDef } from '#core/domain/aggregate/aggregate-def';
import type { AnyModuleDef } from '#core/domain/contracts/module-def';
import type { AnyEventDef, DomainEvent } from '#core/domain/events/event-def';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import type { ErrorOf } from '#core/kernel/errors/error-def';
import { ok, type Result } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import type { Clock } from '../context';
import type { EventEnvelope, PublishedEvent } from '../events/event-envelope';
import type { Outbox } from '../events/outbox';
import { type FieldChange, FieldDiff } from '../oplog/field-diff';
import type { RedactedChange } from '../oplog/operation-record';
import { DeclaredSet } from './declared-set';
import { type Repository, VersionConflict } from './repository';

/**
 * Что UoW нужно от агрегата: идентификатор, версии, события, отметка записи.
 * `baselineState` и `currentState` — для патча в логе (D-86); без
 * `currentState` патча нет. Читать их вне UoW запрещает lint DOM-17.
 */
export type Committable = {
  readonly uuid: string;
  readonly version: number;
  readonly storedVersion: number | undefined;
  readonly baselineState?: object | undefined;
  readonly currentState?: object;
  pullEvents(): readonly DomainEvent[];
  markStored(): void;
};

/**
 * Запись агрегата фиксацией (D-73): версия до (`null` — создан) и после.
 * Идёт в лог операций — по ней видно, что изменила операция.
 */
export type AggregateWrite = {
  readonly aggregate: string;
  readonly uuid: string;
  readonly from: number | null;
  readonly to: number;
  /** Изменённые поля; нет — агрегат без state или сбой расчёта. */
  readonly changes?: readonly (FieldChange | RedactedChange)[];
};

/** Ошибка фиксации: запись изменили параллельно. */
export type CommitError = ErrorOf<typeof CoreErrors.VERSION_CONFLICT>;

export type UnitOfWorkContext = {
  /** Куда уходят конверты записанных агрегатов (D-47). */
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly trace: Trace;
  /** Заявленные события операции; без поля проверка не выполняется. */
  readonly emits?: readonly AnyEventDef[];
  /** Модуль операции (D-28): UoW меняет только его агрегаты (MAN-13). */
  readonly module: Pick<AnyModuleDef, 'name' | 'aggregates'>;
  /** Агрегаты, которые операции разрешено менять; без поля — любые. */
  readonly touches?: readonly AnyAggregateDef[];
  /** Что делать с расхождением с контрактом; по умолчанию — `throw`. */
  readonly onViolation?: (message: string) => void;
  /** Куда сообщить о сбое расчёта патча записи; без поля — молча. */
  readonly warn?: (message: string) => void;
};

type Entry = {
  readonly ar: Committable;
  readonly aggregate: string;
  /** Схема state — по ней патч скрывает помеченные поля. */
  readonly state: v.GenericSchema;
  readonly save: () => Promise<void>;
};

/**
 * Единица работы одной операции (D-15): зарегистрированные агрегаты
 * сохраняются последовательно, затем их события уходят в outbox. Отката
 * нет — JSON-хранилище не атомарно; сбой сохранения отменяет публикацию.
 */
export class UnitOfWork {
  private readonly entries: Entry[] = [];
  private readonly sent: PublishedEvent[] = [];
  private readonly written: AggregateWrite[] = [];
  /** Агрегаты своего модуля (MAN-13) — по ссылке. */
  private readonly own: DeclaredSet<AnyAggregateDef>;
  /** Заявленные `touches` — по ссылке; без поля — любые. */
  private readonly touches: DeclaredSet<AnyAggregateDef>;
  /** Имена заявленных `emits`; без поля — любые. */
  private readonly emits: DeclaredSet<string>;

  constructor(private readonly ctx: UnitOfWorkContext) {
    const { module, touches, emits, onViolation } = ctx;
    this.own = new DeclaredSet(module.aggregates, onViolation);
    this.touches = new DeclaredSet(touches, onViolation);
    this.emits = new DeclaredSet(
      emits?.map((e) => e.name),
      onViolation,
    );
  }

  register<A extends Committable>(ar: A, repo: Repository<A>): void {
    const { aggregate } = repo;
    this.own.assert(
      aggregate,
      `UoW: MAN-13: агрегат ${aggregate.name} не из модуля ${this.ctx.module.name}`,
    );
    this.touches.assert(
      aggregate,
      `UoW: агрегат ${aggregate.name} не заявлен в touches`,
    );
    if (this.entries.some((e) => e.ar === ar)) return;
    this.entries.push({
      ar,
      aggregate: repo.aggregate.name,
      state: repo.aggregate.state,
      save: () => repo.save(ar),
    });
  }

  /**
   * Порядок (D-15): сверка событий с `emits` → запись агрегатов в порядке
   * регистрации → события записанных одной партией в outbox. `Ok` —
   * опубликованные события; при сбое опубликованное видно в `published`.
   * @see docs/concepts/aggregate-lifecycle.md
   * @see src/app/uow/unit-of-work.test.ts
   */
  async commit(): Promise<Result<readonly PublishedEvent[], CommitError>> {
    const batches = this.entries.map(({ ar }) =>
      ar.pullEvents().map((event) => this.envelope(event, ar.uuid)),
    );
    for (const { name } of batches.flat()) {
      this.emits.assert(name, `UoW: событие ${name} не заявлено в emits`);
    }
    let written = 0;
    try {
      for (const entry of this.entries) {
        const { ar, aggregate } = entry;
        const from = ar.storedVersion ?? null;
        await entry.save();
        // Патч — до markStored: он переносит baselineState на currentState.
        const changes = this.changesOf(entry);
        ar.markStored();
        this.written.push({
          aggregate,
          uuid: ar.uuid,
          from,
          to: ar.version,
          ...(changes === undefined ? {} : { changes }),
        });
        written++;
      }
    } catch (error) {
      const stored = batches.slice(0, written).flat();
      if (!(error instanceof VersionConflict)) {
        await this.send(stored).catch((outboxError: unknown) => {
          throw withOutboxFailure(error, outboxError);
        });
        throw error;
      }
      await this.send(stored);
      return CoreErrors.VERSION_CONFLICT.err({
        aggregate: error.aggregate.name,
        uuid: error.uuid,
      });
    }
    await this.send(batches.flat());
    return ok(this.published);
  }

  /** События, опубликованные этой UoW (в том числе до сбоя фиксации). */
  get published(): readonly PublishedEvent[] {
    return [...this.sent];
  }

  /** Записанные агрегаты (в том числе до сбоя фиксации), D-73. */
  get writes(): readonly AggregateWrite[] {
    return [...this.written];
  }

  private changesOf({
    ar,
    aggregate,
    state,
  }: Entry): AggregateWrite['changes'] {
    try {
      const current = ar.currentState;
      if (current === undefined) return undefined;
      return new FieldDiff(state).between(ar.baselineState, current);
    } catch (error) {
      this.ctx.warn?.(
        `UoW: патч записи ${aggregate} ${ar.uuid} не рассчитан — ${messageOf(error)}`,
      );
      return undefined;
    }
  }

  private async send(envelopes: readonly EventEnvelope[]): Promise<void> {
    if (envelopes.length === 0) return;
    await this.ctx.outbox.put(envelopes);
    for (const { name, eventId } of envelopes)
      this.sent.push({ name, eventId });
  }

  private envelope(event: DomainEvent, aggregateId: string): EventEnvelope {
    return {
      ...event,
      eventId: crypto.randomUUID(),
      occurredAt: this.ctx.clock(),
      aggregateId,
      ...this.ctx.trace.toEnvelope(),
    };
  }
}

/**
 * Исходное исключение сохранения со сбоем outbox после него: сбой outbox —
 * в `cause`, если он свободен; иначе — `AggregateError` из обоих.
 */
function withOutboxFailure(error: unknown, outboxError: unknown): unknown {
  if (error instanceof Error && error.cause === undefined) {
    error.cause = outboxError;
    return error;
  }
  return new AggregateError(
    [error, outboxError],
    `UoW: сбой сохранения (${messageOf(error)}), затем сбой outbox (${messageOf(outboxError)})`,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
