import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import type { Caller } from '#core/kernel/caller/caller';
import { ok } from '#core/kernel/result/result';
import type { TodoDeps } from '#core/testing/example/backend/todo/todo.module';
import {
  ListTasksUcDef,
  type TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';

export class ListTasksUc extends UseCaseFromDef<
  typeof ListTasksUcDef,
  TodoDeps,
  undefined,
  ExampleUser
> {
  constructor(deps: TodoDeps, module: typeof TodoModuleDef) {
    super(ListTasksUcDef, deps, module);
  }

  protected async load() {
    return ok(undefined);
  }

  /** Выход — `view()` задач владельца: чужие отсекает выборка по субъекту. */
  protected async execute(
    _: unknown,
    __: undefined,
    ___: UnitOfWork,
    caller: Caller<ExampleUser>,
  ) {
    const owner = this.subject(caller).uuid;
    const tasks = await this.resolve.tasks.findActiveByOwner(owner);
    return ok(tasks.map((task) => task.view()));
  }
}
