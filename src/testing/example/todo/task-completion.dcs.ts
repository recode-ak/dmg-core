import type { RejectOf } from '#core/domain/aggregate/aggregate.types';
import { ok, type Result } from '#core/kernel/result/result';
import type { Timestamp } from '#core/kernel/time/timestamp';
import type { TaskAr, TaskArDef } from './task/task.ar';

/**
 * Выполнение набора задач одной операцией (DOM-06): переход решает каждый
 * `TaskAr.complete`, первый отказ — отказ всей операции. UC регистрирует
 * задачи в UoW только при `ok`; отката у UoW нет (D-15) — допущение
 * учебного примера: запись набора не атомарна.
 */
export class TaskCompletionDcs {
  constructor(private readonly tasks: readonly TaskAr[]) {}

  /** Выполняет все задачи набора и возвращает их в порядке набора. */
  completeAll(
    at: Timestamp,
  ): Result<readonly TaskAr[], RejectOf<typeof TaskArDef, 'complete'>> {
    for (const task of this.tasks) {
      const res = task.complete(at);
      if (!res.ok) return res;
    }
    return ok(this.tasks);
  }
}
