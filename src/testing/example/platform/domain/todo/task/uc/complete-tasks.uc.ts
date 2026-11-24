import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { TaskArDef } from '../task.ar';
import { TaskErrors } from '../task.errors';
import { TaskEvents } from '../task.events';
import { TaskPolicy } from '../task.policy';
import { TaskState } from '../task.state';

/** Предел набора задач одной команды `completeTasks`. */
export const TASK_BATCH_LIMIT = 10;

/**
 * Выполнение выбранных задач одной командой: право — `canManageAll` над
 * всем набором, переходы — `TaskCompletionDcs`. Повтор id во входе — одна
 * задача; события `completed` — в порядке входа.
 */
export const CompleteTasksUcDef = UseCaseDef.define({
  name: 'completeTasks',
  label: 'Выполнить задачи',
  description: 'Отмечает выбранные открытые задачи выполненными.',
  type: 'command',
  aggregate: TaskArDef,
  callers: ['user'],
  visible: true,
  policy: TaskPolicy.rules.canManageAll,
  input: v.object({
    taskIds: v.pipe(
      v.array(TaskState.entries.uuid),
      v.minLength(1),
      v.maxLength(TASK_BATCH_LIMIT),
      v.description('Задачи'),
    ),
  }),
  output: v.object({}),
  errors: [TaskErrors.NOT_FOUND, TaskErrors.ALREADY_DONE, TaskErrors.ARCHIVED],
  emits: [TaskEvents.completed],
});
