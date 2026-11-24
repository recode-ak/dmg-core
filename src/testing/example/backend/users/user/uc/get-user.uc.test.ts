import { beforeEach, describe, expect, it } from 'bun:test';
import { ModuleFacades } from '#core/app/facade/module-facades';
import {
  type Caller,
  DelegateCaller,
  GuestCaller,
  type OperationRef,
  SystemCaller,
  UserCaller,
} from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import {
  type UserState,
  UsersModuleDef,
} from '#core/testing/example/platform/domain/users/index';
import type { ExampleUser } from '#core/testing/example/platform/kernel/app-user';
import { expectErr, expectOk, testAppContext } from '#core/testing/index';
import { UserRepoFake } from '../user.repo.fake';
import { GetUserUc } from './get-user.uc';

// Query для других модулей (system) и человека: ответ — «активна ли учётная
// запись», а не state; человеку — по праву canView (сам или администратор),
// системный вызов проходит без Policy.

const ACTIVE = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const OTHER = '1f2e3d4c-5b6a-4978-8a1b-2c3d4e5f6a7b';
const REMOVED = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T0 = Date.UTC(2026, 9, 1);
const REQ = Trace.fromRequest({ requestId: 'r-1' });

const from: OperationRef = {
  kind: 'useCase',
  module: 'todo',
  name: 'assignTask',
};
const as = (uuid: string, admin = false) =>
  new UserCaller<ExampleUser>({ uuid, hasRole: () => admin });
const person = as(ACTIVE);
const system = new SystemCaller(from, person);
const DENIED = {
  rule: 'canView',
  denyMessage:
    'Карточку пользователя видит сам пользователь или администратор.',
};

const row = (uuid: string, status: 'active' | 'removed'): UserState => ({
  uuid,
  status,
  createdAt: T0,
  updatedAt: T0,
  version: 0,
});

let users: UserRepoFake;
let ctx: ReturnType<typeof testAppContext>;
let uc: GetUserUc;

beforeEach(() => {
  users = new UserRepoFake().seed(
    row(ACTIVE, 'active'),
    row(REMOVED, 'removed'),
  );
  ctx = testAppContext({ at: T0 });
  uc = new GetUserUc(
    { app: ctx.app, facades: new ModuleFacades(), users },
    UsersModuleDef,
  );
});

const get = (userId: string, caller: Caller<ExampleUser> = system) =>
  uc.handle({ userId }, caller, REQ);

describe('GetUserUc', () => {
  it('активная учётная запись — active: true', async () => {
    expect(expectOk(await get(ACTIVE))).toEqual({
      userId: ACTIVE,
      active: true,
    });
  });

  it('удалённая учётная запись — active: false', async () => {
    expect(expectOk(await get(REMOVED))).toEqual({
      userId: REMOVED,
      active: false,
    });
  });

  it('нет пользователя — USER_NOT_FOUND', async () => {
    const missing = crypto.randomUUID();
    expect(expectErr(await get(missing), 'USER_NOT_FOUND').payload).toEqual({
      userId: missing,
    });
  });

  it('системный вызов без человека — отвечает без Policy', async () => {
    expectOk(await get(ACTIVE, new SystemCaller(from)));
    expectOk(await get(REMOVED, new SystemCaller(from)));
  });

  it('системный вызов с человеком без роли о другом — отвечает (право решил вызывающий)', async () => {
    expect(expectOk(await get(REMOVED, system))).toEqual({
      userId: REMOVED,
      active: false,
    });
  });

  it('пользователь о себе — ok', async () => {
    expect(expectOk(await get(ACTIVE, as(ACTIVE)))).toEqual({
      userId: ACTIVE,
      active: true,
    });
  });

  it('пользователь без роли о другом — ACCESS_DENIED с правилом canView', async () => {
    expect(
      expectErr(await get(ACTIVE, as(OTHER)), 'ACCESS_DENIED').payload,
    ).toEqual(DENIED);
  });

  it('администратор о другом — ok, в том числе об удалённом (active: false)', async () => {
    expect(expectOk(await get(ACTIVE, as(OTHER, true)))).toEqual({
      userId: ACTIVE,
      active: true,
    });
    expect(expectOk(await get(REMOVED, as(OTHER, true)))).toEqual({
      userId: REMOVED,
      active: false,
    });
  });

  it('пользователь без роли об удалённом другом — ACCESS_DENIED: статус не раскрыт', async () => {
    expect(
      expectErr(await get(REMOVED, as(OTHER)), 'ACCESS_DENIED').payload,
    ).toEqual(DENIED);
  });

  it('делегат о своём доверителе — ok, в том числе только для чтения', async () => {
    const actor = as(OTHER).user;
    const principal = as(ACTIVE).user;
    expectOk(await get(ACTIVE, new DelegateCaller(principal, actor, 'd-1')));
    expectOk(
      await get(ACTIVE, new DelegateCaller(principal, actor, 'd-1', true)),
    );
  });

  it('делегат о другом пользователе — ACCESS_DENIED', async () => {
    const delegate = new DelegateCaller(as(ACTIVE).user, as(OTHER).user, 'd-1');
    expectErr(await get(REMOVED, delegate), 'ACCESS_DENIED');
  });

  it('гость — UNAUTHORIZED', async () => {
    expectErr(await get(ACTIVE, new GuestCaller()), 'UNAUTHORIZED');
  });

  it('нет пользователя — USER_NOT_FOUND до Policy, и для человека без роли', async () => {
    const missing = crypto.randomUUID();
    expectErr(await get(missing, as(OTHER)), 'USER_NOT_FOUND');
    expectErr(await get(missing, as(missing)), 'USER_NOT_FOUND');
  });

  it('query ничего не пишет и не публикует', async () => {
    const before = users.restored(ACTIVE)?.snapshot();
    expectOk(await get(ACTIVE));
    expect(users.restored(ACTIVE)?.snapshot()).toEqual(before);
    expect(users.saved).toEqual([]);
    expect(ctx.published).toEqual([]);
  });
});
