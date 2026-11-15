import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { BaseEntityFields, F } from '#core/kernel/fields/fields';
import { FieldDiff } from './field-diff';

// Патч записи агрегата для лога операций (D-85): что изменила операция,
// по полям state; помеченные поля — без значений.

const T0 = Date.UTC(2026, 9, 1);
const T1 = T0 + 60_000;

const Item = v.object({
  name: F.string('Название'),
  code: F.sensitive(F.string('Код')),
});

const State = v.object({
  ...BaseEntityFields,
  title: F.string('Название'),
  status: F.picklist(['open', 'done'], 'Статус'),
  tags: v.array(v.string()),
  owner: v.object({
    name: F.string('Имя'),
    contact: v.object({ city: F.string('Город') }),
  }),
  pin: v.optional(F.sensitive(F.string('Пин'))),
  items: v.array(Item),
  doneAt: v.optional(F.timestamp('выполнения')),
});

type State = v.InferOutput<typeof State>;

const base = (): State => ({
  uuid: '7b0c1f5e-4a5b-4c8e-9a51-2f6d3e8b9c10',
  createdAt: T0,
  updatedAt: T0,
  version: 3,
  title: 'Задача',
  status: 'open',
  tags: ['a'],
  owner: { name: 'Нур', contact: { city: 'Уральск' } },
  items: [{ name: 'хлеб', code: '111' }],
});

const diff = new FieldDiff(State);

/** Изменения в порядке пути: порядок обхода — не контракт. */
function changes(before: State | undefined, after: State) {
  return [...diff.between(before, after)].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}

describe('FieldDiff.between — изменённый агрегат', () => {
  test('примитив — лист: путь, было, стало', () => {
    expect(changes(base(), { ...base(), status: 'done' })).toEqual([
      { path: 'status', from: 'open', to: 'done' },
    ]);
  });

  test('вложенный объект — по полям, путь через точку', () => {
    const after = {
      ...base(),
      owner: { name: 'Нур', contact: { city: 'Астана' } },
    };
    expect(changes(base(), after)).toEqual([
      { path: 'owner.contact.city', from: 'Уральск', to: 'Астана' },
    ]);
  });

  test('массив — лист целиком', () => {
    expect(changes(base(), { ...base(), tags: ['a', 'b'] })).toEqual([
      { path: 'tags', from: ['a'], to: ['a', 'b'] },
    ]);
  });

  test('одинаковые листы не пишутся: структурное равенство, не ссылка', () => {
    const after = {
      ...base(),
      tags: ['a'],
      owner: structuredClone(base().owner),
    };
    expect(changes(base(), after)).toEqual([]);
  });

  test('BaseEntityFields пропускаются', () => {
    const after = { ...base(), updatedAt: T1, version: 4 };
    expect(changes(base(), after)).toEqual([]);
  });

  test('появилось необязательное поле — from: undefined', () => {
    expect(changes(base(), { ...base(), doneAt: T1 })).toEqual([
      { path: 'doneAt', from: undefined, to: T1 },
    ]);
  });

  test('пропало необязательное поле — to: undefined', () => {
    expect(changes({ ...base(), doneAt: T1 }, base())).toEqual([
      { path: 'doneAt', from: T1, to: undefined },
    ]);
  });

  test('несколько полей — запись на каждый изменённый лист', () => {
    const after = { ...base(), title: 'Другая', status: 'done' as const };
    expect(changes(base(), after)).toEqual([
      { path: 'status', from: 'open', to: 'done' },
      { path: 'title', from: 'Задача', to: 'Другая' },
    ]);
  });
});

describe('FieldDiff.between — созданный агрегат', () => {
  test('базы нет — поля верхнего уровня с from: undefined, кроме BaseEntityFields', () => {
    expect(changes(undefined, base())).toEqual([
      { path: 'items', redacted: true },
      { path: 'owner', from: undefined, to: base().owner },
      { path: 'status', from: undefined, to: 'open' },
      { path: 'tags', from: undefined, to: ['a'] },
      { path: 'title', from: undefined, to: 'Задача' },
    ]);
  });
});

describe('FieldDiff.between — помеченные поля', () => {
  test('помеченный лист — redacted без значений', () => {
    const [change] = changes(
      { ...base(), pin: '1111' },
      { ...base(), pin: '2222' },
    );
    expect(change).toEqual({ path: 'pin', redacted: true });
    expect(JSON.stringify(change)).not.toContain('1111');
    expect(JSON.stringify(change)).not.toContain('2222');
  });

  test('массив VO с помеченным полем — redacted без значений', () => {
    const after = { ...base(), items: [{ name: 'хлеб', code: '222' }] };
    const result = changes(base(), after);
    expect(result).toEqual([{ path: 'items', redacted: true }]);
    expect(JSON.stringify(result)).not.toContain('111');
  });

  test('одинаковый помеченный лист не пишется', () => {
    expect(changes({ ...base(), pin: '1' }, { ...base(), pin: '1' })).toEqual(
      [],
    );
  });
});

describe('FieldDiff.between — state-variant и union', () => {
  const Variant = v.variant('kind', [
    v.object({
      ...BaseEntityFields,
      kind: v.literal('a'),
      secret: F.sensitive(F.string('Секрет')),
      note: v.string(),
    }),
    v.object({ ...BaseEntityFields, kind: v.literal('b'), open: v.string() }),
  ]);
  const head = {
    uuid: '7b0c1f5e-4a5b-4c8e-9a51-2f6d3e8b9c10',
    createdAt: T0,
    updatedAt: T0,
    version: 1,
  };
  const variantDiff = new FieldDiff(Variant);
  const sortedOf = (d: FieldDiff, before: object | undefined, after: object) =>
    [...d.between(before, after)].sort((a, b) => a.path.localeCompare(b.path));

  test('изменение помеченного поля ветки — redacted, значений нет', () => {
    const result = sortedOf(
      variantDiff,
      { ...head, kind: 'a', secret: 'old', note: 'n' },
      { ...head, kind: 'a', secret: 'NEW', note: 'm' },
    );
    expect(result).toEqual([
      { path: 'note', from: 'n', to: 'm' },
      { path: 'secret', redacted: true },
    ]);
    expect(JSON.stringify(result)).not.toContain('NEW');
  });

  test('созданный — помеченное поле ветки redacted', () => {
    const result = sortedOf(variantDiff, undefined, {
      ...head,
      kind: 'a',
      secret: 'NEW',
      note: 'n',
    });
    expect(result).toEqual([
      { path: 'kind', from: undefined, to: 'a' },
      { path: 'note', from: undefined, to: 'n' },
      { path: 'secret', redacted: true },
    ]);
  });

  test('смена ветки — помеченное поле прежней ветки redacted', () => {
    const result = sortedOf(
      variantDiff,
      { ...head, kind: 'a', secret: 'old', note: 'n' },
      { ...head, kind: 'b', open: 'o' },
    );
    expect(result).toContainEqual({ path: 'secret', redacted: true });
    expect(JSON.stringify(result)).not.toContain('old');
  });

  test('union объектов — поле помечено хотя бы в одной ветке: redacted', () => {
    const Union = v.union([
      v.object({ ...BaseEntityFields, secret: F.sensitive(v.string()) }),
      v.object({ ...BaseEntityFields, secret: v.number(), x: v.string() }),
    ]);
    const result = sortedOf(
      new FieldDiff(Union),
      { ...head, secret: 'old', x: 'a' },
      { ...head, secret: 'NEW', x: 'b' },
    );
    expect(result).toEqual([
      { path: 'secret', redacted: true },
      { path: 'x', from: 'a', to: 'b' },
    ]);
  });
});

describe('FieldDiff.between — object_with_rest', () => {
  const Rest = v.objectWithRest(
    { ...BaseEntityFields, title: v.string() },
    F.sensitive(v.string()),
  );
  const head = {
    uuid: '7b0c1f5e-4a5b-4c8e-9a51-2f6d3e8b9c10',
    createdAt: T0,
    updatedAt: T0,
    version: 1,
  };
  const restDiff = new FieldDiff(Rest);

  test('ключ вне entries — по схеме rest: redacted', () => {
    const result = restDiff.between(
      { ...head, title: 't', extra: 'old' },
      { ...head, title: 't', extra: 'NEW' },
    );
    expect(result).toEqual([{ path: 'extra', redacted: true }]);
  });

  test('созданный — ключ вне entries redacted', () => {
    const result = restDiff.between(undefined, { ...head, extra: 'NEW' });
    expect(result).toEqual([{ path: 'extra', redacted: true }]);
  });
});
