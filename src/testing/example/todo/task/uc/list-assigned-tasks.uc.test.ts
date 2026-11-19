import { describe, expect, it } from 'bun:test';
import { normalize } from '#core/graph/normalize';
import { ListAssignedTasksUcDef } from './list-assigned-tasks.uc';

describe('ListAssignedTasksUcDef', () => {
  it('query пользователя, виден в UI: вызывающий — только user', () => {
    expect(normalize(ListAssignedTasksUcDef)).toMatchObject({
      name: 'listAssignedTasks',
      type: 'query',
      aggregate: 'task',
      callers: ['user'],
      visible: true,
      errors: [],
      emits: [],
    });
  });
});
