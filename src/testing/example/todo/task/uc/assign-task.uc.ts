import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { GetUserUcDef, UserErrors } from '#core/testing/example/users/contract';
import { TaskArDef } from '../task.ar';
import { TaskErrors } from '../task.errors';
import { TaskEvents } from '../task.events';
import { TaskPolicy } from '../task.policy';
import { TaskRules } from '../task.rules';
import { TaskAssignmentVo, TaskState } from '../task.state';

/**
 * Назначение исполнителя — command с вызовом чужого модуля: `fetch` после
 * Policy спрашивает `users`, решение — правило `assigneeActive` (API-01).
 * Порядок отказов: нет задачи → нет пользователя (ERR-03) → Policy →
 * исполнитель неактивен → задача не открыта.
 */
export const AssignTaskUcDef = UseCaseDef.define({
  name: 'assignTask',
  label: 'Назначить задачу',
  description:
    'Назначает открытой задаче исполнителя — активного пользователя.',
  type: 'command',
  aggregate: TaskArDef,
  callers: ['user'],
  visible: true,
  policy: TaskPolicy.rules.canManage,
  rules: [TaskRules.rules.assigneeActive],
  calls: [GetUserUcDef],
  input: v.object({
    taskId: TaskState.entries.uuid,
    assigneeId: TaskAssignmentVo.entries.assigneeId,
  }),
  output: v.object({}),
  errors: [
    TaskErrors.NOT_FOUND,
    UserErrors.NOT_FOUND,
    TaskErrors.ASSIGNEE_INACTIVE,
    TaskErrors.NOT_ASSIGNABLE,
  ],
  emits: [TaskEvents.unassigned, TaskEvents.assigned],
});
