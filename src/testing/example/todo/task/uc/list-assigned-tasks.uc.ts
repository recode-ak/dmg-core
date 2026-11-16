import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { allowAll } from '#core/domain/policy/rule';
import { TaskArDef } from '../task.ar';
import { TaskState } from '../task.state';

/**
 * Задачи, назначенные вызывающему: исполнитель — из вызывающего, а не из
 * входа, поэтому право выполняется всегда (`allowAll`). Владелец в выходе —
 * чья задача.
 */
export const ListAssignedTasksUcDef = UseCaseDef.define({
  name: 'listAssignedTasks',
  label: 'Назначенные мне',
  description: 'Неархивные задачи других владельцев, назначенные вызывающему.',
  type: 'query',
  aggregate: TaskArDef,
  callers: ['user'],
  visible: true,
  policy: allowAll,
  input: v.object({}),
  output: v.array(v.pick(TaskState, ['uuid', 'title', 'status', 'ownerId'])),
  errors: [],
});
