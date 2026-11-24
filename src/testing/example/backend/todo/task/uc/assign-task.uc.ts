import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import type { Caller } from '#core/kernel/caller/caller';
import { ok } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import type { TodoDeps } from '#core/testing/example/backend/todo/todo.module';
import {
  AssignTaskUcDef,
  type TaskAr,
  TaskErrors,
  type TodoModuleDef,
} from '#core/testing/example/platform/domain/todo/index';
import {
  GetUserUcDef,
  type UserActivity,
} from '#core/testing/example/platform/domain/users/contract';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';

type Input = { readonly taskId: string; readonly assigneeId: string };

/** Контекст Policy `canManage`. */
type Loaded = { readonly task: TaskAr };

/** Контекст правила `assigneeActive` — ответ `users`. */
type Fetched = { readonly assignee: UserActivity };

/**
 * Назначение исполнителя (D-58): `load` — задача (контекст Policy), `fetch`
 * — ответ `users` после права (не-владелец не узнаёт о пользователе),
 * правило `assigneeActive` — над ним, `execute` — переход `TaskAr.assign`.
 * Решений по ответу `users` в UC нет (API-01).
 */
export class AssignTaskUc extends UseCaseFromDef<
  typeof AssignTaskUcDef,
  TodoDeps,
  Loaded,
  ExampleUser,
  Fetched
> {
  constructor(deps: TodoDeps, module: typeof TodoModuleDef) {
    super(AssignTaskUcDef, deps, module);
  }

  /** Задача — из репозитория. */
  protected async load({ taskId }: Input) {
    const task = await this.resolve.tasks.findById(taskId);
    if (!task) return TaskErrors.NOT_FOUND.err({ taskId });
    return ok({ task });
  }

  /** Исполнитель — ответ `users` через фасад, после Policy. */
  protected override async fetch(
    { assigneeId }: Input,
    _loaded: Loaded,
    caller: Caller<ExampleUser>,
    trace: Trace,
  ) {
    const assignee = await this.call(
      GetUserUcDef,
      { userId: assigneeId },
      caller,
      trace,
    );
    if (!assignee.ok) return assignee;
    return ok({ assignee: assignee.value });
  }

  protected async execute(
    { assigneeId }: Input,
    { task }: Loaded & Fetched,
    uow: UnitOfWork,
  ) {
    const res = task.assign(assigneeId, this.now());
    if (!res.ok) return res;
    uow.register(task, this.resolve.tasks);
    return ok({});
  }
}
