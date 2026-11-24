import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import { ok } from '#core/kernel/result/result';
import type { TodoDeps } from '#core/testing/example/backend/todo/todo.module';
import {
  GetTaskAssigneeUcDef,
  type TaskAr,
  TaskErrors,
  type TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';

type Loaded = { readonly task: TaskAr };

/**
 * Исполнитель задачи для системных вызовов (получатели уведомлений): право
 * не проверяется (`allowAll`), человек за вызовом не нужен.
 */
export class GetTaskAssigneeUc extends UseCaseFromDef<
  typeof GetTaskAssigneeUcDef,
  TodoDeps,
  Loaded
> {
  constructor(deps: TodoDeps, module: typeof TodoModuleDef) {
    super(GetTaskAssigneeUcDef, deps, module);
  }

  protected async load({ taskId }: { taskId: string }) {
    const task = await this.resolve.tasks.findById(taskId);
    return task ? ok({ task }) : TaskErrors.NOT_FOUND.err({ taskId });
  }

  /** Без исполнителя — пустой ответ. */
  protected async execute(_: unknown, { task }: Loaded, __: UnitOfWork) {
    const assignment = task.view().assignment;
    return ok(assignment ? { assigneeId: assignment.assigneeId } : {});
  }
}
