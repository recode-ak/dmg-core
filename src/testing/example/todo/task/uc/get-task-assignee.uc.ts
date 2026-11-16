import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { allowAll } from '#core/domain/policy/rule';
import { TaskArDef } from '../task.ar';
import { TaskErrors } from '../task.errors';
import { TaskAssignmentVo, TaskState } from '../task.state';

/**
 * Исполнитель задачи — для системных вызовов (получатели уведомлений):
 * `allowAll`, потому что человека за вызовом нет. Модуль, вызвавший UC в
 * потоке пользователя, ответ человеку не возвращает; защита — `callers:
 * ['system']` и отсутствие `visible`. Без исполнителя — пустой ответ.
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
