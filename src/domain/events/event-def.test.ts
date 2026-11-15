import { describe, expect, expectTypeOf, it } from 'bun:test';
import * as v from 'valibot';
import { Def } from '#core/kernel/def/def';
import { toJsonSchema } from '#core/kernel/schema/json-schema';
import { EventDef } from './event-def';

const TaskEvents = EventDef.define('todo.task', {
  completed: {
    label: 'Задача завершена',
    description: 'Задача отмечена выполненной.',
    payload: v.object({ taskId: v.string() }),
  },
});

describe('EventDef', () => {
  it('define — группа Def-классов, имя = префикс + ключ', () => {
    const def = TaskEvents.completed;
    expect(def).toBeInstanceOf(EventDef);
    expect(def).toBeInstanceOf(Def);
    expect(def.dmg).toBe('event');
    expect(def.name).toBe('todo.task.completed');
    expectTypeOf(def.name).toEqualTypeOf<'todo.task.completed'>();
  });

  it('make() — событие с payload по схеме', () => {
    const e = TaskEvents.completed.make({ taskId: 't1' });
    expect(e).toEqual({
      name: 'todo.task.completed',
      payload: { taskId: 't1' },
    });
  });

  it('normalize() — тексты и JSON Schema payload', () => {
    expect(TaskEvents.completed.normalize()).toEqual({
      dmg: 'event',
      name: 'todo.task.completed',
      label: 'Задача завершена',
      description: 'Задача отмечена выполненной.',
      visible: false,
      exposed: false,
      payload: toJsonSchema(v.object({ taskId: v.string() })),
    });
  });

  it('exposed: по умолчанию false, объявлен — true в Def и форме (D-94)', () => {
    expect(TaskEvents.completed.exposed).toBe(false);
    const Open = EventDef.define('todo.open', {
      shared: {
        label: 'Событие наружу',
        description: 'Событие, которое видят другие приложения.',
        exposed: true,
        payload: v.object({}),
      },
    });
    expect(Open.shared.exposed).toBe(true);
    expect(Open.shared.normalize()).toMatchObject({ exposed: true });
  });

  it('describe() — схема payload', () => {
    const def = TaskEvents.completed;
    expect(def.describe().schemas).toEqual([['payload', def.payload]]);
  });
});
