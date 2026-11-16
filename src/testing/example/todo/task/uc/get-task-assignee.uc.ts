import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { allowAll } from '#core/domain/policy/rule';
import { TaskArDef } from '../task.ar';
import { TaskErrors } from '../task.errors';
import { TaskAssignmentVo, TaskState } from '../task.state';

/**
 * Исполнитель задачи — для системных вызовов без человека (получатели
 * уведомлений): `callers: ['system']`, право не нужно (`allowAll`).
 * Задача без исполнителя — пустой ответ.
 */
export const GetTaskAssigneeUcDef = UseCaseDef.define({
  name: 'getTaskAssignee',
  label: 'Исполнитель задачи',
  description: 'Исполнитель задачи по идентификатору — для системных вызовов.',
  type: 'query',
  aggregate: TaskArDef,
  callers: ['system'],
  policy: allowAll,
  input: v.object({ taskId: TaskState.entries.uuid }),
  output: v.object({
    assigneeId: v.optional(TaskAssignmentVo.entries.assigneeId),
  }),
  errors: [TaskErrors.NOT_FOUND],
});
