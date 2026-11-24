import * as v from 'valibot';
import { UseCaseDef } from '#core/domain/contracts/use-case-def';
import { allowAll } from '#core/domain/policy/rule';
import { TaskArDef } from '../task.ar';
import { TaskState } from '../task.state';

/**
 * Задачи вызывающего — state целиком: клиент восстанавливает
 * `TaskAr.readonly` и считает правила сам (D-104). Владелец — из
 * вызывающего, а не из входа, поэтому право выполняется всегда
 * (`allowAll`); чужие state отсекает выборка по субъекту.
 */
export const ListTasksUcDef = UseCaseDef.define({
  name: 'listTasks',
  label: 'Мои задачи',
  description:
    'Неархивные задачи вызывающего (открытые и выполненные) — state целиком, вместе с названием.',
  type: 'query',
  aggregate: TaskArDef,
  callers: ['user'],
  visible: true,
  policy: allowAll,
  input: v.object({}),
  output: v.array(TaskState),
  errors: [],
});
