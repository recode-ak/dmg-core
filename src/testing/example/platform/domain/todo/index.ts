// Публичный API учебного модуля todo для своего пакета реализации
// (`example/backend/todo`): контракт (с Ar, Policy и правилами), state, ArDef,
// DCS и Def реакций и задач. Другие модули импортируют только `contract.ts`.
export * from './contract';
export * from './state';
export { ReleaseRemovedUserTasksErDef } from './task/er/release-removed-user-tasks.er';
export { ArchiveDoneTasksJobDef } from './task/job/archive-done-tasks.job';
export {
  type CreateTask,
  TaskArDef,
  type TaskError,
} from './task/task.ar';
export { TASK_BATCH_LIMIT } from './task/uc/complete-tasks.uc';
export { TaskCompletionDcs } from './task-completion.dcs';
export { TaskReleaseDcs } from './task-release.dcs';
export type { TaskRelease } from './task-release.types';
