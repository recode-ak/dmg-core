import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import { ok } from '#core/kernel/result/result';
import type { TodoDeps } from '#core/testing/example/backend/todo/todo.module';
import {
  CompleteTaskUcDef,
  type TaskAr,
  TaskErrors,
  type TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';

type Loaded = { readonly task: TaskAr };

export class CompleteTaskUc extends UseCaseFromDef<
  typeof CompleteTaskUcDef,
  TodoDeps,
  Loaded,
  ExampleUser
> {
  constructor(deps: TodoDeps, module: typeof TodoModuleDef) {
    super(CompleteTaskUcDef, deps, module);
  }

  protected async load({ taskId }: { taskId: string }) {
    const task = await this.resolve.tasks.findById(taskId);
    return task ? ok({ task }) : TaskErrors.NOT_FOUND.err({ taskId });
  }

  protected async execute(
    { expectedVersion }: { expectedVersion?: number },
    { task }: Loaded,
    uow: UnitOfWork,
  ) {
    // Устаревшее действие клиента — отказ до операции.
    const expected = this.expectVersion(task, expectedVersion);
    if (!expected.ok) return expected;
    const res = task.complete(this.now());
    if (!res.ok) return res;
    uow.register(task, this.resolve.tasks);
    return ok({});
  }
}
