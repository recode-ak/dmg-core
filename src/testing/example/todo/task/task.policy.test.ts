import { describe, expect, it } from 'bun:test';
import { allowed, denied } from '#core/index';
import { TaskAr } from './task.ar';
import { type TaskBatchCtx, type TaskCtx, TaskPolicy } from './task.policy';

type Role = 'admin' | 'student';
type User = { uuid: string; hasRole(role: Role): boolean };

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const user = (uuid: string, ...roles: Role[]): User => ({
  uuid,
  hasRole: (role) => roles.includes(role),
});

const ctx: TaskCtx = {
  task: TaskAr.restore({
    uuid: '0b6f2c1e-8a4d-4f3b-9c2e-1d5a7b9e3f10',
    ownerId: OWNER,
    title: 'Купить хлеб',
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    version: 0,
  }),
};

const canManage = TaskPolicy.rules.canManage;

describe('TaskPolicy.canManage', () => {
  it('владелец — allowed', () => {
    expect(canManage.evaluate(user(OWNER), ctx)).toEqual(allowed);
  });

  it('администратор — allowed для чужой задачи', () => {
    expect(canManage.evaluate(user(OTHER, 'admin'), ctx)).toEqual(allowed);
  });

  it('чужой без роли — denied', () => {
    expect(canManage.evaluate(user(OTHER, 'student'), ctx)).toEqual(
      denied(
        'canManage',
        'Управлять задачей может владелец или администратор.',
      ),
    );
  });

  it('без субъекта (гость, system без человека) — denied', () => {
    expect(canManage.evaluate(undefined, ctx).allowed).toBe(false);
  });
});

const ownTask = (ownerId: string) =>
  TaskAr.restore({
    uuid: crypto.randomUUID(),
    ownerId,
    title: 'Задача',
    status: 'open',
    createdAt: 0,
    updatedAt: 0,
    version: 0,
  });

const batch = (...owners: string[]): TaskBatchCtx => ({
  tasks: owners.map(ownTask),
});

const canManageAll = TaskPolicy.rules.canManageAll;

describe('TaskPolicy.canManageAll — набор задач', () => {
  it('владелец всех задач набора — allowed', () => {
    expect(canManageAll.evaluate(user(OWNER), batch(OWNER, OWNER))).toEqual(
      allowed,
    );
  });

  it('одна задача набора чужая — denied правилом canManageAll', () => {
    expect(
      canManageAll.evaluate(user(OWNER, 'student'), batch(OWNER, OTHER)),
    ).toMatchObject({ allowed: false, rule: 'canManageAll' });
  });

  it('администратор — allowed для чужих задач', () => {
    expect(
      canManageAll.evaluate(user(OTHER, 'admin'), batch(OWNER, OWNER)),
    ).toEqual(allowed);
  });

  it('без субъекта — denied', () => {
    expect(canManageAll.evaluate(undefined, batch(OWNER)).allowed).toBe(false);
  });
});
