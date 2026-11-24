import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import { ok } from '#core/kernel/result/result';
import type { TodoDeps } from '#core/testing/example/backend/todo/todo.module';
import {
  CompleteTasksUcDef,
  type TaskAr,
  TaskCompletionDcs,
  TaskErrors,
  type TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';

/** Контекст Policy `canManageAll` — задачи набора в порядке входа. */
type Loaded = { readonly tasks: readonly TaskAr[] };

/**
 * Выполнение набора задач: `load` — задачи по уникальным id (повтор во
 * входе — одна задача), Policy `canManageAll` — над всем набором, `execute`
 * — `TaskCompletionDcs`; в UoW задачи попадают только при успехе всего
 * набора, поэтому отказ любой задачи ничего не пишет.
 */
export class CompleteTasksUc extends UseCaseFromDef<
  typeof CompleteTasksUcDef,
  TodoDeps,
  Loaded,
  ExampleUser
> {
  constructor(deps: TodoDeps, module: typeof TodoModuleDef) {
    super(CompleteTasksUcDef, deps, module);
  }

  /** Задачи — из репозитория; первой отсутствующей — `TASK_NOT_FOUND`. */
  protected async load({ taskIds }: { taskIds: string[] }) {
    const tasks: TaskAr[] = [];
    for (const taskId of new Set(taskIds)) {
      const task = await this.resolve.tasks.findById(taskId);
      if (!task) return TaskErrors.NOT_FOUND.err({ taskId });
      tasks.push(task);
    }
    return ok({ tasks });
  }

  protected async execute(_: unknown, { tasks }: Loaded, uow: UnitOfWork) {
    const res = new TaskCompletionDcs(tasks).completeAll(this.now());
    if (!res.ok) return res;
    for (const task of res.value) uow.register(task, this.resolve.tasks);
    return ok({});
  }
}
