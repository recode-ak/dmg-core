import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import type { Caller } from '#core/kernel/caller/caller';
import { ok } from '#core/kernel/result/result';
import type { TodoDeps } from '#core/testing/example/app/todo/todo.module';
import type { ExampleUser } from '#core/testing/example/shared/app-user';
import {
  ListAssignedTasksUcDef,
  type TodoModuleDef,
} from '#core/testing/example/todo/index';

export class ListAssignedTasksUc extends UseCaseFromDef<
  typeof ListAssignedTasksUcDef,
  TodoDeps,
  undefined,
  ExampleUser
> {
  constructor(deps: TodoDeps, module: typeof TodoModuleDef) {
    super(ListAssignedTasksUcDef, deps, module);
  }

  protected async load() {
    return ok(undefined);
  }

  /**
   * Исполнитель — субъект вызывающего; выход — `view()` назначенных ему
   * задач: чужие отсекает выборка по субъекту.
   */
  protected async execute(
    _: unknown,
    __: undefined,
    ___: UnitOfWork,
    caller: Caller<ExampleUser>,
  ) {
    const assignee = this.subject(caller).uuid;
    const tasks = await this.resolve.tasks.findActiveByAssignee(assignee);
    return ok(tasks.map((task) => task.view()));
  }
}
