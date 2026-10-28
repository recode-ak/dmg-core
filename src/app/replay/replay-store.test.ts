import { describe, expect, test } from 'bun:test';
import type { Timestamp } from '#core/kernel/time/timestamp';
import {
  DEFAULT_REPLAY_TTL_MS,
  InProcReplayStore,
  type ReplayClaim,
} from './replay-store';

const T0: Timestamp = Date.UTC(2026, 0, 1);
const KEY = 'todo/user:u-1/r-1';
const INPUT = '{"input":{"title":"Купить хлеб"},"uc":"createTask"}';
const OTHER_INPUT = '{"input":{"title":"Купить молоко"},"uc":"createTask"}';
const ANSWER = { ok: true, value: { taskId: 't-1' } };

/** Токен владельца записи из итога `claim`; другой итог — ошибка теста. */
function tokenOf(claim: ReplayClaim): string {
  if (claim.kind !== 'claimed')
    throw new Error(`ожидался claimed, ${claim.kind}`);
  return claim.token;
}

/** Хранилище с часами, которые переводит тест. */
function store(options: { readonly capacity?: number; ttlMs?: number } = {}) {
  let now = T0;
  const replay = new InProcReplayStore({ clock: () => now, ...options });
  const advance = (ms: number): void => {
    now += ms;
  };
  return { replay, advance };
}

describe('InProcReplayStore', () => {
  test('свободный ключ занимается; повтор того же входа — «в работе»', async () => {
    const { replay } = store();
    expect(await replay.claim(KEY, INPUT)).toMatchObject({ kind: 'claimed' });
    expect(await replay.claim(KEY, INPUT)).toStrictEqual({
      kind: 'conflict',
      reason: 'in_progress',
    });
  });

  test('после complete повтор того же входа получает сохранённый ответ', async () => {
    const { replay } = store();
    const token = tokenOf(await replay.claim(KEY, INPUT));
    await replay.complete(KEY, token, ANSWER);
    expect(await replay.claim(KEY, INPUT)).toStrictEqual({
      kind: 'answered',
      answer: ANSWER,
    });
  });

  test('другой вход с тем же ключом — конфликт input (в работе и после ответа)', async () => {
    const { replay } = store();
    const token = tokenOf(await replay.claim(KEY, INPUT));
    expect(await replay.claim(KEY, OTHER_INPUT)).toStrictEqual({
      kind: 'conflict',
      reason: 'input',
    });
    await replay.complete(KEY, token, ANSWER);
    expect(await replay.claim(KEY, OTHER_INPUT)).toStrictEqual({
      kind: 'conflict',
      reason: 'input',
    });
  });

  test('другой ключ — отдельная запись', async () => {
    const { replay } = store();
    await replay.claim(KEY, INPUT);
    expect(await replay.claim('todo/user:u-2/r-1', INPUT)).toMatchObject({
      kind: 'claimed',
    });
  });

  test('после release ключ снова свободен', async () => {
    const { replay } = store();
    const token = tokenOf(await replay.claim(KEY, INPUT));
    await replay.release(KEY, token);
    expect(await replay.claim(KEY, OTHER_INPUT)).toMatchObject({
      kind: 'claimed',
    });
  });

  test('complete без записи (снята или забыта) — ничего не сохраняет', async () => {
    const { replay } = store();
    await replay.complete(KEY, 'чужой', ANSWER);
    expect((await replay.claim(KEY, INPUT)).kind).toBe('claimed');
  });

  test('TTL по умолчанию — 24 ч', () => {
    expect(DEFAULT_REPLAY_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  test('TTL истёк — ключ свободен: и ответ, и запись «в работе»', async () => {
    const { replay, advance } = store();
    const token = tokenOf(await replay.claim(KEY, INPUT));
    await replay.complete(KEY, token, ANSWER);
    advance(DEFAULT_REPLAY_TTL_MS - 1);
    expect((await replay.claim(KEY, INPUT)).kind).toBe('answered');
    advance(1);
    expect(await replay.claim(KEY, OTHER_INPUT)).toMatchObject({
      kind: 'claimed',
    });
    advance(DEFAULT_REPLAY_TTL_MS);
    expect(await replay.claim(KEY, INPUT)).toMatchObject({ kind: 'claimed' });
  });

  test('TTL ответа считается от complete', async () => {
    const { replay, advance } = store({ ttlMs: 100 });
    const token = tokenOf(await replay.claim(KEY, INPUT));
    advance(60);
    await replay.complete(KEY, token, ANSWER);
    advance(60);
    expect((await replay.claim(KEY, INPUT)).kind).toBe('answered');
  });

  test('сверх ёмкости забываются самые старые записи', async () => {
    const { replay } = store({ capacity: 2 });
    await replay.claim('k-1', INPUT);
    await replay.claim('k-2', INPUT);
    await replay.claim('k-3', INPUT);
    expect(await replay.claim('k-1', INPUT)).toMatchObject({ kind: 'claimed' });
    expect((await replay.claim('k-3', INPUT)).kind).toBe('conflict');
  });

  test('complete освежает запись: старейшей становится другая', async () => {
    const { replay } = store({ capacity: 2 });
    const token = tokenOf(await replay.claim('k-1', INPUT));
    await replay.claim('k-2', INPUT);
    await replay.complete('k-1', token, ANSWER);
    await replay.claim('k-3', INPUT);
    expect((await replay.claim('k-1', INPUT)).kind).toBe('answered');
    expect(await replay.claim('k-2', INPUT)).toMatchObject({ kind: 'claimed' });
  });

  test('claim выдаёт новый токен владельца на каждое занятие', async () => {
    const { replay } = store();
    const first = tokenOf(await replay.claim(KEY, INPUT));
    await replay.release(KEY, first);
    expect(tokenOf(await replay.claim(KEY, INPUT))).not.toBe(first);
  });

  test('поздний итог прежнего владельца не трогает чужую запись', async () => {
    const { replay, advance } = store({ ttlMs: 100 });
    const late = tokenOf(await replay.claim(KEY, INPUT));
    advance(100);
    const owner = tokenOf(await replay.claim(KEY, INPUT));
    await replay.complete(KEY, late, ANSWER);
    await replay.release(KEY, late);
    expect(await replay.claim(KEY, INPUT)).toStrictEqual({
      kind: 'conflict',
      reason: 'in_progress',
    });
    await replay.complete(KEY, owner, ANSWER);
    expect((await replay.claim(KEY, INPUT)).kind).toBe('answered');
  });

  test('ответ хранится копией: правка отданного или исходного его не меняет', async () => {
    const { replay } = store();
    const answer = { ok: true, value: { tags: ['a'] } };
    const token = tokenOf(await replay.claim(KEY, INPUT));
    await replay.complete(KEY, token, answer);
    answer.value.tags.push('исходный');
    const first = await replay.claim(KEY, INPUT);
    if (first.kind !== 'answered') throw new Error('ожидался answered');
    (first.answer as typeof answer).value.tags.push('отданный');
    expect(await replay.claim(KEY, INPUT)).toStrictEqual({
      kind: 'answered',
      answer: { ok: true, value: { tags: ['a'] } },
    });
  });
});
