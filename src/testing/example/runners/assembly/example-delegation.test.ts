import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DelegationClaim,
  DelegationRecord,
  DelegationStore,
} from '#core/app/index';
import {
  DelegateCaller,
  type OperationRef,
  SystemCaller,
} from '#core/kernel/caller/caller';
import { Trace } from '#core/kernel/trace/trace';
import {
  RemoveUserUcDef,
  UsersModuleDef,
} from '#core/testing/example/platform/domain/users/contract';
import { expectErr, expectOk, MemoryLogger } from '#core/testing/index';
import type { ExampleUser } from '../../platform/kernel/app-user';
import { ExampleApp } from './example-app';
import { ExampleDelegationStore } from './example-delegation-store';

// Резолвер образца с заявкой на делегирование (D-89): проверка заявки —
// `DelegationCheck` (его сценарии — в delegation-check.test.ts), здесь —
// только сборка резолвера: личность транспорта, активность людей,
// `readOnly` из записи, отказ вместо тихого входа «как сам себе».

const PRINCIPAL = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ACTOR = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const STRANGER = '1f2e3d4c-5b6a-4978-8a1b-2c3d4e5f6a7b';
const T0 = Date.UTC(2026, 9, 1);
const admin: OperationRef = { kind: 'useCase', module: 'admin', name: 'purge' };
const req = (): Trace => Trace.fromRequest({ requestId: crypto.randomUUID() });

const RECORD: DelegationRecord = {
  delegationId: 'del-1',
  principalId: PRINCIPAL,
  actorId: ACTOR,
  expiresAt: T0 + 60_000,
  revoked: false,
  readOnly: false,
};

const CLAIM: DelegationClaim = {
  principalId: PRINCIPAL,
  actorId: ACTOR,
  delegationId: 'del-1',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'example-delegation-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Порт на записях образца; считает обращения. */
function countingStore(records: DelegationRecord[]) {
  const inner = new ExampleDelegationStore(records);
  const calls: string[] = [];
  const store: DelegationStore = {
    find(delegationId) {
      calls.push(delegationId);
      return inner.find(delegationId);
    },
  };
  return { store, calls };
}

function makeApp(
  delegations: DelegationStore | undefined,
  users: string[] = [PRINCIPAL, ACTOR],
) {
  return new ExampleApp(
    { mode: 'test', dataDir: dir, users },
    { logger: new MemoryLogger(), clock: () => T0, delegations },
  );
}

async function removeUser(app: ExampleApp, userId: string) {
  expectOk(
    await app.api.dispatch(
      UsersModuleDef,
      RemoveUserUcDef.command({ userId }),
      new SystemCaller<ExampleUser>(admin),
      req(),
    ),
  );
}

describe('ExampleApp.callers с заявкой на делегирование', () => {
  it('успех: DelegateCaller, subject — замещаемый, actor — заместитель', async () => {
    const app = makeApp(new ExampleDelegationStore([RECORD]));

    const caller = expectOk(await app.callers.resolve(ACTOR, req(), CLAIM));

    expect(caller).toBeInstanceOf(DelegateCaller);
    if (!(caller instanceof DelegateCaller)) return;
    expect(caller.subject().uuid).toBe(PRINCIPAL);
    expect(caller.actor.uuid).toBe(ACTOR);
    expect(caller.delegationId).toBe('del-1');
    expect(caller.readOnly).toBe(false);
  });

  it('readOnly берётся из записи, а не из заявки', async () => {
    const app = makeApp(
      new ExampleDelegationStore([{ ...RECORD, readOnly: true }]),
    );

    const caller = expectOk(await app.callers.resolve(ACTOR, req(), CLAIM));

    expect(caller).toBeInstanceOf(DelegateCaller);
    if (!(caller instanceof DelegateCaller)) return;
    expect(caller.readOnly).toBe(true);
  });

  it('отказ проверки возвращается как есть (отозвано)', async () => {
    const app = makeApp(
      new ExampleDelegationStore([{ ...RECORD, revoked: true }]),
    );

    const res = await app.callers.resolve(ACTOR, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'revoked',
    });
  });

  it('порт не задан — disabled', async () => {
    const app = makeApp(undefined);

    const res = await app.callers.resolve(ACTOR, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'disabled',
    });
  });

  it('транспорт назвал другого, чем заместитель в заявке — invalid', async () => {
    const app = makeApp(new ExampleDelegationStore([RECORD]));

    const res = await app.callers.resolve(STRANGER, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  it('заявка без uuid транспорта — invalid, не гость', async () => {
    const app = makeApp(new ExampleDelegationStore([RECORD]));

    const res = await app.callers.resolve(undefined, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  it('замещаемый не найден — invalid', async () => {
    const app = makeApp(new ExampleDelegationStore([RECORD]), [ACTOR]);

    const res = await app.callers.resolve(ACTOR, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  it('замещаемый удалён — invalid', async () => {
    const app = makeApp(new ExampleDelegationStore([RECORD]));
    await removeUser(app, PRINCIPAL);

    const res = await app.callers.resolve(ACTOR, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  it('заместитель удалён — invalid', async () => {
    const app = makeApp(new ExampleDelegationStore([RECORD]));
    await removeUser(app, ACTOR);

    const res = await app.callers.resolve(ACTOR, req(), CLAIM);

    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  for (const field of ['principalId', 'actorId', 'delegationId'] as const) {
    it(`пустое поле заявки ${field} — invalid, порт не вызван`, async () => {
      const { store, calls } = countingStore([RECORD]);
      const app = makeApp(store);

      // Транспорт назвал ту же пустоту — иначе отказ даёт сверка uuid, а не проверка поля.
      const uuid = field === 'actorId' ? '' : ACTOR;
      const res = await app.callers.resolve(uuid, req(), {
        ...CLAIM,
        [field]: '',
      });

      expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
        reason: 'invalid',
      });
      expect(calls).toEqual([]);
    });
  }

  it('исключение порта пробрасывается — не гость и не отказ', async () => {
    const app = makeApp({
      async find() {
        throw new Error('диск недоступен');
      },
    });

    await expect(app.callers.resolve(ACTOR, req(), CLAIM)).rejects.toThrow(
      'диск недоступен',
    );
  });
});
