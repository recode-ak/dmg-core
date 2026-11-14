import type { AnyAggregateDef } from '#core/domain/aggregate/aggregate-def';
import type { AnyModuleDef } from '#core/domain/contracts/module-def';
import type {
  AnyOperationDef,
  OperationDmg,
} from '#core/domain/contracts/operation-def.types';
import type {
  AnyUseCaseDef,
  InputOf,
  OutputOf,
  UseCaseErrorOf,
} from '#core/domain/contracts/use-case-def';
import {
  type Caller,
  type OperationRef,
  SystemCaller,
} from '#core/kernel/caller/caller';
import type { DomainError } from '#core/kernel/errors/error';
import { serializeError } from '#core/kernel/errors/serialize-error';
import type { Result } from '#core/kernel/result/result';
import type { Timestamp } from '#core/kernel/time/timestamp';
import type { Trace } from '#core/kernel/trace/trace';
import type { ModuleDeps } from '../context';
import type { OperationRecord } from '../oplog/operation-record';
import {
  type OperationCall,
  OperationRun,
  type OutputMode,
} from '../oplog/operation-run';
import { UnitOfWork } from '../uow/unit-of-work';

export type { AnyOperationDef };

/**
 * UC других модулей, которые операция объявила в `calls`. Нет `calls` (или
 * пустой список) — `never`: вызвать нечего.
 */
export type CallsOf<D> = D extends { readonly calls?: infer C }
  ? C extends readonly (infer U extends AnyUseCaseDef)[]
    ? U
    : never
  : never;

/** Где в Def модуля лежат операции каждого вида и как их называть. */
const PLACE = {
  useCase: { list: 'useCases', label: 'UC' },
  eventReaction: { list: 'reactions', label: 'ER' },
  job: { list: 'jobs', label: 'Job' },
} as const;

/**
 * Общая база UC, ER и Job по Def (D-43): ссылка на операцию, часы приложения,
 * типизированный вызов UC другого модуля и лог операций. Def не из
 * модуля-владельца — исключение сборки.
 */
export abstract class OperationFromDef<
  D extends AnyOperationDef,
  R extends ModuleDeps,
> {
  /** Эта операция — `from` вызывающего, когда она зовёт другие модули. */
  readonly ref: OperationRef;
  /** Модуль-владелец: его агрегаты — единственные, что меняет UoW (MAN-13). */
  private readonly module: AnyModuleDef;

  /** Def не из модуля — исключение (ошибка сборки). */
  protected constructor(
    readonly def: D,
    protected readonly resolve: R,
    module: AnyModuleDef,
    kind: OperationDmg,
  ) {
    const { list, label } = PLACE[kind];
    const own: readonly AnyOperationDef[] = module[list];
    if (!own.includes(def)) {
      throw new Error(`${label} ${def.name} не входит в модуль ${module.name}`);
    }
    this.ref = { kind, module: module.name, name: def.name };
    this.module = module;
  }

  /** Текущий момент по часам приложения — передаётся в операции домена. */
  protected now(): Timestamp {
    return this.resolve.app.clock();
  }

  /**
   * UoW вызова со сверкой по Def: события — `emits`, агрегаты — свой модуль
   * (MAN-13) и `touches`/`scans`. Расхождение — исключение, в production —
   * `warn`: отказ пользователю из-за описания контракта хуже записи для
   * разбора.
   */
  protected createUow(trace: Trace): UnitOfWork {
    const { app } = this.resolve;
    const def: AnyOperationDef = this.def;
    const touches = touchesOf(def);
    return new UnitOfWork({
      outbox: app.outbox,
      clock: app.clock,
      trace,
      module: this.module,
      emits: def.emits ?? [],
      ...(touches === undefined ? {} : { touches }),
      ...(app.mode === 'production'
        ? {
            onViolation: (message: string) =>
              app.logger.warn(def.name, message),
          }
        : {}),
    });
  }

  /**
   * UC другого модуля — только из `calls` Def. Вызывающий — `SystemCaller`
   * этой операции с человеком пришедшего (без вложенности), след — дальше по
   * цепочке; отказ вызванного UC — его ответ как есть.
   */
  protected call<C extends CallsOf<D>>(
    def: C,
    input: InputOf<C>,
    caller: Caller,
    trace: Trace,
  ): Promise<Result<OutputOf<C>, UseCaseErrorOf<C>>> {
    return this.resolve.facades.call(
      def,
      input,
      new SystemCaller(this.ref, caller.person()),
      trace,
    );
  }

  /**
   * Вызов операции с записью в лог операций последним шагом при любом
   * исходе; `body` не бросает. Сбой записи лога — только `warn`: данные уже
   * зафиксированы, отказ вызвал бы повтор и дубль. `output` — как писать
   * выход: query пишет сводку размера (D-73).
   */
  protected async journal<T, E extends DomainError>(
    call: OperationCall,
    body: (run: OperationRun) => Promise<Result<T, E>>,
    output: OutputMode = 'full',
  ): Promise<Result<T, E>> {
    const run = new OperationRun(this.ref, this.now(), call, output);
    const result = await body(run);
    await this.append(run.record(result));
    return result;
  }

  private async append(record: OperationRecord): Promise<void> {
    try {
      await this.resolve.app.oplog.append(record);
    } catch (error) {
      this.resolve.app.logger.warn(
        this.def.name,
        'Не удалось записать лог операции',
        serializeError(error),
      );
    }
  }
}

/** Агрегаты, которые операции разрешено менять; у UC — без ограничения. */
function touchesOf(
  def: AnyOperationDef,
): readonly AnyAggregateDef[] | undefined {
  if (def.dmg === 'eventReaction') return def.touches;
  if (def.dmg === 'job') return def.scans;
  return undefined;
}
