import type { OutputOf } from '#core/index';
import type { ExampleCallerResolver } from '../app/example-caller-resolver';
import type { ExampleUser } from '../shared/app-user';
import { ListTasksUcDef, TaskEvents, TodoModuleDef } from '../todo/contract';
import type { ScreenSession } from './screen-session';

/**
 * Код экрана «Мои задачи»: по событию «задача создана» выбирает вызывающего
 * (владелец через резолвер, D-98) и обновляет список вызовом `listTasks`.
 */
export class TasksScreen {
  private list: OutputOf<typeof ListTasksUcDef> = [];

  constructor(
    private readonly session: ScreenSession<ExampleUser>,
    private readonly callers: ExampleCallerResolver,
  ) {}

  open(): void {
    this.session.on(TaskEvents.created, async (envelope, trace) => {
      const caller = await this.callers.resolve(
        envelope.payload.ownerId,
        trace,
      );
      if (!caller.ok) return;
      const res = await this.session.dispatch(
        TodoModuleDef,
        ListTasksUcDef,
        {},
        caller.value,
        trace,
      );
      if (res.ok) this.list = res.value;
    });
  }

  /** Последний показанный список; до события — пустой. */
  items(): OutputOf<typeof ListTasksUcDef> {
    return this.list;
  }

  close(): void {
    this.session.close();
  }
}
