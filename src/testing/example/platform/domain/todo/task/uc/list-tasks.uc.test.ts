import { describe, expect, it } from 'bun:test';
import { normalize } from '#core/graph/normalize';
import { ListTasksUcDef } from './list-tasks.uc';

describe('ListTasksUcDef', () => {
  it('query пользователя, виден в UI: вызывающий — только user', () => {
    expect(normalize(ListTasksUcDef)).toMatchObject({
      name: 'listTasks',
      type: 'query',
      aggregate: 'task',
      callers: ['user'],
      visible: true,
      errors: [],
      emits: [],
    });
  });
});
