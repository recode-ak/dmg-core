import { ModuleDef } from '#core/domain/contracts/module-def';
import { UsersModuleDef } from '#core/testing/example/users/contract';
import { ReleaseRemovedUserTasksErDef } from './task/er/release-removed-user-tasks.er';
import { ArchiveDoneTasksJobDef } from './task/job/archive-done-tasks.job';
import { TaskArDef } from './task/task.ar';
import { AssignTaskUcDef } from './task/uc/assign-task.uc';
import { CompleteTaskUcDef } from './task/uc/complete-task.uc';
import { CompleteTasksUcDef } from './task/uc/complete-tasks.uc';
import { CreateTaskUcDef } from './task/uc/create-task.uc';
import { GetTaskUcDef } from './task/uc/get-task.uc';
import { GetTaskAssigneeUcDef } from './task/uc/get-task-assignee.uc';
import { ListAssignedTasksUcDef } from './task/uc/list-assigned-tasks.uc';
import { ListTasksUcDef } from './task/uc/list-tasks.uc';

/** Паспорт модуля todo; зависимость — из контракта `users` (ARC-04, D-45). */
export const TodoModuleDef = ModuleDef.define({
  name: 'todo',
  label: 'Задачи',
  description: 'Учебный модуль DMG: личный список дел. Эталон для тестов core.',
  dependsOn: [UsersModuleDef],
  aggregates: [TaskArDef],
  useCases: [
    CreateTaskUcDef,
    CompleteTaskUcDef,
    ListTasksUcDef,
    GetTaskUcDef,
    AssignTaskUcDef,
    CompleteTasksUcDef,
    ListAssignedTasksUcDef,
    GetTaskAssigneeUcDef,
  ],
  reactions: [ReleaseRemovedUserTasksErDef],
  jobs: [ArchiveDoneTasksJobDef],
});
