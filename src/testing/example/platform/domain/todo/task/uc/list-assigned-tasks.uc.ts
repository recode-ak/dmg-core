import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { allowAll } from '#core/domain/policy/rule';
import { TaskArDef } from '../task.ar';
import { TaskState } from '../task.state';

/**
 * Задачи, назначенные вызывающему, — state целиком (D-104). Исполнитель —
 * из вызывающего, а не из входа, поэтому право выполняется всегда
 * (`allowAll`); чужой `ownerId` он видит, а что ему можно с задачей,
 * решает `TaskPolicy.canManage` на сервере.
 */
export const ListAssignedTasksUcDef = UseCaseDef.define({
  name: 'listAssignedTasks',
  label: 'Назначенные мне',
  description:
    'Неархивные задачи других владельцев, назначенные вызывающему, — state целиком, вместе с названием.',
  type: 'query',
  aggregate: TaskArDef,
  callers: ['user'],
  visible: true,
  policy: allowAll,
  input: v.object({}),
  output: v.array(TaskState),
  errors: [],
});
