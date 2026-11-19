import { describe, expect, it } from 'bun:test';
import { allowed, denied } from '#core/index';
import { GetUserUcDef } from './uc/get-user.uc';
import { UserAr } from './user.ar';
import { UserPolicy } from './user.policy';

type Role = 'admin' | 'student';
type Person = { uuid: string; hasRole(role: Role): boolean };

const SELF = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const person = (uuid: string, ...roles: Role[]): Person => ({
  uuid,
  hasRole: (role) => roles.includes(role),
});

const ctx = {
  user: UserAr.restore({
    uuid: SELF,
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
    version: 0,
  }),
};

const { canView } = UserPolicy.rules;

describe('UserPolicy.canView', () => {
  it('сам пользователь — allowed', () => {
    expect(canView.evaluate(person(SELF, 'student'), ctx)).toEqual(allowed);
  });

  it('администратор — allowed для чужой карточки', () => {
    expect(canView.evaluate(person(OTHER, 'admin'), ctx)).toEqual(allowed);
  });

  it('чужой без роли — denied', () => {
    expect(canView.evaluate(person(OTHER, 'student'), ctx)).toEqual(
      denied(
        'canView',
        'Карточку пользователя видит сам пользователь или администратор.',
      ),
    );
  });

  it('без субъекта (гость, system без человека) — denied', () => {
    expect(canView.evaluate(undefined, ctx).allowed).toBe(false);
  });
});

describe('GetUserUcDef и UserPolicy', () => {
  it('право getUser — именно canView', () => {
    expect(GetUserUcDef.policy).toBe(canView);
  });
});
