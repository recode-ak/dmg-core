import type { OutputOf } from '#core/index';
import {
  ListTasksUcDef,
  TaskEvents,
  TodoModuleDef,
} from '../platform/domain/todo/contract';
import type { ExampleUser } from '../platform/kernel/app-user';
import type { ExampleCallerResolver } from '../runners/assembly/example-caller-resolver';
import type { ScreenSession } from './screen-session';

/**
 * Экран «Мои задачи» пользователя `userId` (D-98): по его событию «задача
 * создана» вызывает `listTasks` от его имени через резолвер; события других
 * пользователей пропускает.
 */
export class TasksScreen {
  private list: OutputOf<typeof ListTasksUcDef> = [];
  private off: (() => void) | undefined;
  private requests = 0;

  constructor(
    private readonly session: ScreenSession<ExampleUser>,
    private readonly callers: ExampleCallerResolver,
    private readonly userId: string,
  ) {}

  /** Подписывает экран; повторный вызов при открытом экране ничего не делает. */
  open(): void {
    if (this.off) return;
    this.off = this.session.on(TaskEvents.created, async (envelope, trace) => {
      if (envelope.payload.ownerId !== this.userId) return;
      // Обработчики идут параллельно и завершаются в любом порядке:
      // применяется ответ последнего запроса, а не пришедший последним.
      const request = ++this.requests;
      const caller = await this.callers.resolve(this.userId, trace);
      // Отказ резолвера — список прежний; настоящий экран показывает текст
      // отказа (см. `ErrorText`).
      if (!caller.ok) return;
      const res = await this.session.dispatch(
        TodoModuleDef,
        ListTasksUcDef,
        {},
        caller.value,
        trace,
      );
      if (request !== this.requests) return;
      // Отказ UC — так же: список прежний.
      if (!res.ok) return;
      this.list = res.value;
    });
  }

  /** Последний показанный список; до события — пустой. */
  items(): OutputOf<typeof ListTasksUcDef> {
    return this.list;
  }

  /** Снимает подписки сессии; после него экран можно открыть снова. */
  close(): void {
    this.session.close();
    this.off = undefined;
  }
}
