import type { ReadonlyAr } from '#core/domain/aggregate/readonly-ar';
import { PolicyDef } from '#core/domain/policy/policy-def';
import { Rule } from '#core/domain/policy/rule';
import type { TaskAr } from './task.ar';

/** Контекст правил задачи: задача, над которой действие. */
export type TaskCtx = { readonly task: ReadonlyAr<TaskAr> };

/** Контекст правил набора задач: задачи, над которыми одно действие. */
export type TaskBatchCtx = { readonly tasks: readonly ReadonlyAr<TaskAr>[] };

const isOwner = Rule.of({
  name: 'isOwner',
  label: 'Владелец задачи',
  denyMessage: 'Задачей управляет только её владелец.',
  check: (subject: { readonly uuid: string }, ctx: TaskCtx) =>
    ctx.task.isOwnedBy(subject.uuid),
});

const ownsAll = Rule.of({
  name: 'ownsAll',
  label: 'Владелец всех задач',
  denyMessage: 'Набором задач управляет только владелец каждой из них.',
  check: (subject: { readonly uuid: string }, ctx: TaskBatchCtx) =>
    ctx.tasks.every((task) => task.isOwnedBy(subject.uuid)),
});

// \`every\` на пустом наборе — истина: без этого правила пустой набор прошёл
// бы Policy у любого субъекта, защищала бы только схема входа.
const hasTasks = Rule.of({
  name: 'hasTasks',
  label: 'Набор задач не пуст',
  denyMessage: 'Пустым набором задач управлять нельзя.',
  check: (_subject: unknown, ctx: TaskBatchCtx) => ctx.tasks.length > 0,
});

export const TaskPolicy = PolicyDef.define({
  name: 'task',
  label: 'Права на задачи',
  description:
    'Кто может управлять задачей или набором задач: владелец или администратор.',
  rules: {
    canManage: Rule.anyOf(
      {
        name: 'canManage',
        label: 'Владелец или администратор',
        denyMessage: 'Управлять задачей может владелец или администратор.',
      },
      isOwner,
      Rule.hasRole('admin'),
    ),
    canManageAll: Rule.allOf(
      hasTasks,
      Rule.anyOf(
        {
          name: 'canManageAll',
          label: 'Владелец всех задач или администратор',
          denyMessage:
            'Управлять набором задач может владелец каждой из них или администратор.',
        },
        ownsAll,
        Rule.hasRole('admin'),
      ),
    ),
  },
});
