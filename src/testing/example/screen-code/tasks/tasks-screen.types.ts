import type { DelegationDenied } from '#core/app/index';
import type { PersonCaller, Result, Trace } from '#core/index';
import type { ExampleUser } from '../../platform/kernel/app-user';

/**
 * Резолвер вызывающего экрана задач (D-106, D-110): структурный тип —
 * исполнение экрана сборку не видит, резолвер сборки подходит под него.
 */
export type TasksScreenCallers = {
  resolve(
    uuid: string,
    trace: Trace,
  ): Promise<Result<PersonCaller<ExampleUser>, DelegationDenied>>;
};
