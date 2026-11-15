import { describe, expect, it } from 'bun:test';
import * as v from 'valibot';
import { TaskAssignmentVo, TaskState, TaskStatus } from './task.state';

const TASK = '0b6f2c1e-8a4d-4f3b-9c2e-1d5a7b9e3f10';
const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ASSIGNEE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('TaskAssignmentVo', () => {
  it('принимает исполнителя и момент назначения числом', () => {
    const assignment = {
      assigneeId: ASSIGNEE,
      assignedAt: Date.UTC(2026, 9, 2, 9, 30),
    };
    expect(v.parse(TaskAssignmentVo, assignment)).toEqual(assignment);
  });

  it('отвергает момент назначения ISO-строкой', () => {
    expect(
      v.is(TaskAssignmentVo, {
        assigneeId: ASSIGNEE,
        assignedAt: '2026-10-02T09:30:00.000Z',
      }),
    ).toBe(false);
  });

  it('отклоняет назначение без момента или с невалидным исполнителем', () => {
    expect(v.is(TaskAssignmentVo, { assigneeId: ASSIGNEE })).toBe(false);
    expect(v.is(TaskAssignmentVo, { assigneeId: 'x', assignedAt: 0 })).toBe(
      false,
    );
  });
});

describe('TaskStatus', () => {
  it.each(['open', 'done', 'archived'])('принимает статус %s', (status) => {
    expect(v.is(TaskStatus, status)).toBe(true);
  });

  it('отклоняет неизвестный статус', () => {
    expect(v.is(TaskStatus, 'deleted')).toBe(false);
  });
});

describe('TaskState', () => {
  const base = {
    uuid: TASK,
    ownerId: OWNER,
    title: 'Купить хлеб',
    status: 'open' as const,
    createdAt: Date.UTC(2026, 9, 1, 10),
    updatedAt: Date.UTC(2026, 9, 2, 8, 30),
  };

  it('без назначения; даты числами, версия 0', () => {
    expect(v.parse(TaskState, base)).toEqual({ ...base, version: 0 });
  });

  it('отвергает даты ISO-строками (в т. ч. без зоны)', () => {
    expect(v.is(TaskState, { ...base, createdAt: '2026-10-01T10:00' })).toBe(
      false,
    );
    expect(
      v.is(TaskState, { ...base, updatedAt: '2026-10-02T08:30:00.000Z' }),
    ).toBe(false);
  });

  it('отклоняет пустое название и чужой статус', () => {
    expect(v.is(TaskState, { ...base, title: '' })).toBe(false);
    expect(v.is(TaskState, { ...base, status: 'deleted' })).toBe(false);
  });

  it('с назначением — момент назначения числом', () => {
    const assignment = {
      assigneeId: ASSIGNEE,
      assignedAt: Date.UTC(2026, 9, 2, 9, 30),
    };
    expect(v.parse(TaskState, { ...base, assignment }).assignment).toEqual(
      assignment,
    );
  });

  it('отвергает назначение с моментом ISO-строкой', () => {
    const assignment = { assigneeId: ASSIGNEE, assignedAt: '2026-10-02T09:30' };
    expect(v.is(TaskState, { ...base, assignment })).toBe(false);
  });

  it('у каждого поля и у полей назначения есть описание', () => {
    // Необязательное поле описано на вложенной схеме (`v.optional`).
    const descriptionOf = (field: v.GenericSchema) =>
      v.getDescription(field) ??
      ('wrapped' in field
        ? v.getDescription(field.wrapped as v.GenericSchema)
        : undefined);
    const fields = [
      ...Object.values(TaskState.entries),
      ...Object.values(TaskAssignmentVo.entries),
    ];
    for (const field of fields) {
      expect(descriptionOf(field)).toBeString();
    }
  });
});
