import { describe, expect, test } from 'bun:test';
import type { Timestamp } from '#core/kernel/time/timestamp';
import { expectErr, expectOk } from '#core/testing/index';
import type {
  DelegationClaim,
  DelegationRecord,
  DelegationStore,
} from './delegation.types';
import { DelegationCheck } from './delegation-check';

const EXPIRES: Timestamp = 1_000_000;

const CLAIM: DelegationClaim = {
  principalId: 'principal-1',
  actorId: 'actor-1',
  delegationId: 'del-1',
};

const RECORD: DelegationRecord = {
  delegationId: 'del-1',
  principalId: 'principal-1',
  actorId: 'actor-1',
  expiresAt: EXPIRES,
  revoked: false,
  readOnly: false,
};

/** Порт на одной записи; считает обращения. */
function storeWith(record: DelegationRecord | undefined) {
  const calls: string[] = [];
  const store: DelegationStore = {
    async find(delegationId) {
      calls.push(delegationId);
      return record;
    },
  };
  return { store, calls };
}

function checkAt(record: DelegationRecord | undefined, at: Timestamp) {
  const { store } = storeWith(record);
  return new DelegationCheck(store, () => at);
}

describe('DelegationCheck.verify', () => {
  test('успех за 1 мс до срока: пара совпала, не отозвана — запись как есть', async () => {
    const { store, calls } = storeWith(RECORD);
    const res = await new DelegationCheck(store, () => EXPIRES - 1).verify(
      CLAIM,
    );
    expect(expectOk(res)).toEqual(RECORD);
    expect(calls).toEqual(['del-1']);
  });

  test('успех: readOnly берётся из записи', async () => {
    const res = await checkAt(
      { ...RECORD, readOnly: true },
      EXPIRES - 1,
    ).verify(CLAIM);
    expect(expectOk(res).readOnly).toBe(true);
  });

  test('записи нет → invalid', async () => {
    const res = await checkAt(undefined, EXPIRES - 1).verify(CLAIM);
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  test('чужой замещаемый → invalid', async () => {
    const res = await checkAt(RECORD, EXPIRES - 1).verify({
      ...CLAIM,
      principalId: 'principal-2',
    });
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  test('чужой заместитель → invalid', async () => {
    const res = await checkAt(RECORD, EXPIRES - 1).verify({
      ...CLAIM,
      actorId: 'actor-2',
    });
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  test('чужая пара при отозванной и истёкшей записи → invalid', async () => {
    const res = await checkAt({ ...RECORD, revoked: true }, EXPIRES + 1).verify(
      {
        ...CLAIM,
        actorId: 'actor-2',
      },
    );
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'invalid',
    });
  });

  test('срок наступил (clock === expiresAt) → expired', async () => {
    const res = await checkAt(RECORD, EXPIRES).verify(CLAIM);
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'expired',
    });
  });

  test('после срока → expired', async () => {
    const res = await checkAt(RECORD, EXPIRES + 1).verify(CLAIM);
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'expired',
    });
  });

  test('срок не число (NaN из данных приложения) → expired', async () => {
    const res = await checkAt(
      { ...RECORD, expiresAt: Number.NaN },
      EXPIRES - 1,
    ).verify(CLAIM);
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'expired',
    });
  });

  test('отозвано → revoked', async () => {
    const res = await checkAt({ ...RECORD, revoked: true }, EXPIRES - 1).verify(
      CLAIM,
    );
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'revoked',
    });
  });

  test('отозвано и срок истёк → revoked (раньше expired)', async () => {
    const res = await checkAt({ ...RECORD, revoked: true }, EXPIRES + 1).verify(
      CLAIM,
    );
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'revoked',
    });
  });

  test('порта нет → disabled', async () => {
    const res = await new DelegationCheck(undefined, () => EXPIRES - 1).verify(
      CLAIM,
    );
    expect(expectErr(res, 'DELEGATION_DENIED').payload).toEqual({
      reason: 'disabled',
    });
  });

  test('исключение порта не превращается в отказ', async () => {
    const store: DelegationStore = {
      async find() {
        throw new Error('хранилище недоступно');
      },
    };
    const check = new DelegationCheck(store, () => EXPIRES - 1);
    await expect(check.verify(CLAIM)).rejects.toThrow('хранилище недоступно');
  });
});
