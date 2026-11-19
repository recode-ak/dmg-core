/**
 * Контракт модуля todo (D-45) — вход для остального кода: паспорт модуля,
 * Def UC, события, ошибки; Ar, Policy и правила — по нужде адаптеров и
 * клиентского кода (D-69, D-104). DCS, ArDef и схемы entity (state) сюда не
 * входят: их видят только домен и прикладной слой модуля (`index.ts`).
 */

/**
 * Кто: клиентский код экранов и адаптеры. Зачем: `TaskAr.readonly(строка
 * выхода listTasks)` — вопросы агрегата (`isOwnedBy`, `isOpen`) без запроса
 * (D-72); `create`/`restore` вне модуля — только корень сборки и фикстуры
 * (D-69).
 */
export { TaskAr } from './task/task.ar';
/** Кто: вызывающие UC todo. Зачем: ветвление по коду отказа. */
export { TaskErrors } from './task/task.errors';
/** Кто: реакции других модулей и UI. Зачем: подписка по `TaskEvents.<e>.name`. */
export { TaskEvents } from './task/task.events';
/**
 * Кто: клиентский код и UC модуля. Зачем: `canManage`/`canManageAll` — то же
 * решение, что принимает сервер; клиент его только показывает, сервер
 * перепроверяет каждый вызов. Типы — форма контекста (`{ task }`, `{ tasks }`).
 */
export {
  type TaskBatchCtx,
  type TaskCtx,
  TaskPolicy,
} from './task/task.policy';
/**
 * Кто: клиентский код и UC модуля. Зачем: `withinOpenLimit`, `assigneeActive`
 * — правила с ошибкой и payload; клиент считает «можно ли создать» по задачам
 * из `listTasks`. Типы — форма контекста (`{ ownerTasks }`, `{ assignee }`);
 * `OPEN_TASKS_LIMIT` — тексты и подсказки UI: значение правила, не копия.
 */
export {
  type AssigneeCtx,
  OPEN_TASKS_LIMIT,
  type OwnerTasksCtx,
  TaskRules,
} from './task/task.rules';
/** Кто: транспорт (пользователь, делегат). Зачем: назначение исполнителя задаче. */
export { AssignTaskUcDef } from './task/uc/assign-task.uc';
/** Кто: транспорт. Зачем: отметить задачу выполненной. */
export { CompleteTaskUcDef } from './task/uc/complete-task.uc';
/** Кто: транспорт. Зачем: выполнить выбранные задачи одной командой. */
export { CompleteTasksUcDef } from './task/uc/complete-tasks.uc';
/** Кто: транспорт. Зачем: новая задача в списке вызывающего. */
export { CreateTaskUcDef } from './task/uc/create-task.uc';
/** Кто: другие модули через фасад todo (system). Зачем: задача целиком (D-42). */
export { GetTaskUcDef } from './task/uc/get-task.uc';
/** Кто: другие модули и каналы (system). Зачем: получатель уведомлений о задаче. */
export { GetTaskAssigneeUcDef } from './task/uc/get-task-assignee.uc';
/** Кто: транспорт. Зачем: задачи, назначенные вызывающему. */
export { ListAssignedTasksUcDef } from './task/uc/list-assigned-tasks.uc';
/** Кто: транспорт. Зачем: список задач вызывающего. */
export { ListTasksUcDef } from './task/uc/list-tasks.uc';
/** Кто: `dependsOn` других модулей и сборка приложения. Зачем: паспорт модуля. */
export { TodoModuleDef } from './todo.module';
