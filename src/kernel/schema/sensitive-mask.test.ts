import { beforeEach, describe, expect, expectTypeOf, test } from 'bun:test';
import * as v from 'valibot';
import {
  BaseEntityFields,
  F,
  withEntityDefaults,
} from '#core/kernel/fields/fields';
import { SensitiveMask } from './sensitive-mask';

// Маскирование помеченных полей (D-85): вход — значение «как пришло» и
// схема, выход — копия с `'[redacted]'` вместо помеченных листов.

const SECRET = 'пароль-42';

const Contact = v.object({
  kind: F.string('Вид контакта'),
  value: F.sensitive(F.string('Контакт')),
});

const State = v.object({
  ...BaseEntityFields,
  title: F.sensitive(F.string('Название')),
  ownerId: F.uuid('владельца'),
  contacts: v.array(Contact),
  profile: v.optional(
    v.object({ nick: F.string('Ник'), phone: F.sensitive(F.string('Тел.')) }),
  ),
});

let warns: string[];
let mask: SensitiveMask;

beforeEach(() => {
  warns = [];
  mask = new SensitiveMask((message) => warns.push(message));
});

describe('F.sensitive', () => {
  test('разбор не меняется: тот же выход, те же отказы', () => {
    const schema = F.sensitive(F.string('Пароль'));
    expect(v.parse(schema, SECRET)).toBe(SECRET);
    expect(v.safeParse(schema, '').success).toBe(false);
  });

  test('тип выхода — тип исходной схемы', () => {
    const schema = F.sensitive(F.int('Пин'));
    expectTypeOf<v.InferOutput<typeof schema>>().toEqualTypeOf<number>();
  });
});

describe('SensitiveMask.apply — объекты', () => {
  test('помеченное поле — [redacted], остальные как есть', () => {
    const schema = v.object({
      login: F.string('Логин'),
      password: F.sensitive(F.string('Пароль')),
    });
    expect(mask.apply(schema, { login: 'nur', password: SECRET })).toEqual({
      login: 'nur',
      password: '[redacted]',
    });
  });

  test.each([
    ['loose_object', v.looseObject({ password: F.sensitive(v.string()) })],
    ['strict_object', v.strictObject({ password: F.sensitive(v.string()) })],
    [
      'object_with_rest',
      v.objectWithRest({ password: F.sensitive(v.string()) }, v.string()),
    ],
  ])('%s — помеченное поле [redacted]', (_kind, schema) => {
    expect(mask.apply(schema, { password: SECRET })).toEqual({
      password: '[redacted]',
    });
  });

  test('вложенный объект — помеченное поле внутри [redacted]', () => {
    const value = { profile: { nick: 'n', phone: SECRET } };
    expect(mask.apply(State, value)).toEqual({
      profile: { nick: 'n', phone: '[redacted]' },
    });
  });

  test('лишние ключи вне схемы — как есть', () => {
    const value = { title: SECRET, extra: { deep: 1 }, note: 'x' };
    expect(mask.apply(State, value)).toEqual({
      title: '[redacted]',
      extra: { deep: 1 },
      note: 'x',
    });
  });

  test('отсутствующее помеченное поле не появляется', () => {
    expect(mask.apply(State, { ownerId: 'o' })).toEqual({ ownerId: 'o' });
  });

  test('помеченное поле неверного типа — всё равно [redacted]', () => {
    expect(mask.apply(State, { title: 12345 })).toEqual({
      title: '[redacted]',
    });
  });

  test('исходное значение не меняется', () => {
    const value = { title: SECRET, contacts: [{ kind: 'tel', value: SECRET }] };
    mask.apply(State, value);
    expect(value).toEqual({
      title: SECRET,
      contacts: [{ kind: 'tel', value: SECRET }],
    });
  });

  test('схема без пометок — значение как есть', () => {
    const schema = v.object({ a: v.string(), b: v.array(v.number()) });
    expect(mask.apply(schema, { a: 'x', b: [1, 2] })).toEqual({
      a: 'x',
      b: [1, 2],
    });
  });
});

describe('SensitiveMask.apply — коллекции', () => {
  test('array — помеченное поле в каждом элементе', () => {
    const value = {
      contacts: [
        { kind: 'tel', value: SECRET },
        { kind: 'mail', value: 'a@b.c' },
      ],
    };
    expect(mask.apply(State, value)).toEqual({
      contacts: [
        { kind: 'tel', value: '[redacted]' },
        { kind: 'mail', value: '[redacted]' },
      ],
    });
  });

  test('array помеченных примитивов — каждый элемент [redacted]', () => {
    const schema = v.object({ pins: v.array(F.sensitive(v.string())) });
    expect(mask.apply(schema, { pins: ['1', '2'] })).toEqual({
      pins: ['[redacted]', '[redacted]'],
    });
  });

  test('tuple — помеченная позиция [redacted]', () => {
    const schema = v.tuple([v.string(), F.sensitive(v.string())]);
    expect(mask.apply(schema, ['login', SECRET])).toEqual([
      'login',
      '[redacted]',
    ]);
  });

  test('record — помеченное поле в каждом значении', () => {
    const schema = v.record(v.string(), Contact);
    const value = { home: { kind: 'tel', value: SECRET } };
    expect(mask.apply(schema, value)).toEqual({
      home: { kind: 'tel', value: '[redacted]' },
    });
  });
});

describe('SensitiveMask.apply — обёртки', () => {
  test.each([
    ['optional', v.optional(F.sensitive(v.string()))],
    ['nullable', v.nullable(F.sensitive(v.string()))],
    ['nullish', v.nullish(F.sensitive(v.string()))],
    ['exact_optional', v.exactOptional(F.sensitive(v.string()))],
    ['undefinedable', v.undefinedable(F.sensitive(v.string()))],
  ])('%s — пометка под обёрткой [redacted]', (_kind, field) => {
    const schema = v.object({ secret: field });
    expect(mask.apply(schema, { secret: SECRET })).toEqual({
      secret: '[redacted]',
    });
  });

  test('пометка поверх обёртки — [redacted]', () => {
    const schema = v.object({ secret: F.sensitive(v.optional(v.string())) });
    expect(mask.apply(schema, { secret: SECRET })).toEqual({
      secret: '[redacted]',
    });
  });

  test('pipe — метка не последним элементом', () => {
    const schema = v.object({
      secret: v.pipe(
        v.string(),
        v.metadata({ sensitive: true }),
        v.description('Секрет'),
      ),
    });
    expect(mask.apply(schema, { secret: SECRET })).toEqual({
      secret: '[redacted]',
    });
  });

  test('pipe внутри pipe — метка во внутреннем', () => {
    const schema = v.object({
      secret: v.pipe(F.sensitive(F.string('Секрет')), v.trim()),
    });
    expect(mask.apply(schema, { secret: SECRET })).toEqual({
      secret: '[redacted]',
    });
  });
});

describe('SensitiveMask.apply — варианты', () => {
  const Login = v.variant('kind', [
    v.object({ kind: v.literal('password'), secret: F.sensitive(v.string()) }),
    v.object({ kind: v.literal('guest'), nick: v.string() }),
  ]);

  test('variant — помеченное поле ветки [redacted]', () => {
    expect(mask.apply(Login, { kind: 'password', secret: SECRET })).toEqual({
      kind: 'password',
      secret: '[redacted]',
    });
  });

  test('variant — ветка без пометок как есть', () => {
    expect(mask.apply(Login, { kind: 'guest', nick: 'n' })).toEqual({
      kind: 'guest',
      nick: 'n',
    });
  });

  test('union — пометка хотя бы в одной ветке: значение [redacted]', () => {
    const schema = v.object({
      code: v.union([F.sensitive(v.string()), v.number()]),
    });
    expect(mask.apply(schema, { code: SECRET })).toEqual({
      code: '[redacted]',
    });
  });
});

describe('SensitiveMask.apply — производные схемы', () => {
  test('v.pick — пометка сохраняется', () => {
    const schema = v.pick(State, ['title', 'ownerId']);
    expect(mask.apply(schema, { title: SECRET, ownerId: 'o' })).toEqual({
      title: '[redacted]',
      ownerId: 'o',
    });
  });

  test('поле из entries state в новой схеме — пометка сохраняется', () => {
    const schema = v.object({ name: State.entries.title });
    expect(mask.apply(schema, { name: SECRET })).toEqual({
      name: '[redacted]',
    });
  });

  test('spread entries state и VO — пометки сохраняются', () => {
    const schema = v.object({ ...State.entries, ...Contact.entries });
    expect(mask.apply(schema, { title: SECRET, value: SECRET })).toEqual({
      title: '[redacted]',
      value: '[redacted]',
    });
  });

  test('withEntityDefaults — пометки сохраняются', () => {
    const schema = withEntityDefaults(State);
    expect(mask.apply(schema, { title: SECRET, ownerId: 'o' })).toEqual({
      title: '[redacted]',
      ownerId: 'o',
    });
  });
});

describe('SensitiveMask.apply — сбой', () => {
  test('неизвестный вид схемы (lazy) — значение целиком [redacted] и warn', () => {
    const schema = v.object({
      title: v.string(),
      nested: v.lazy(() => v.object({ secret: F.sensitive(v.string()) })),
    });
    const value = { title: 't', nested: { secret: SECRET } };
    expect(mask.apply(schema, value)).toBe('[redacted]');
    expect(warns).toHaveLength(1);
  });

  test('без warn сбой не бросает', () => {
    const schema = v.lazy(() => v.string());
    expect(new SensitiveMask().apply(schema, SECRET)).toBe('[redacted]');
  });
});

describe('SensitiveMask.containsSensitive', () => {
  test('пометка в поддереве — да', () => {
    expect(mask.containsSensitive(v.array(Contact))).toBe(true);
  });

  test('без пометок — нет', () => {
    expect(mask.containsSensitive(v.object({ a: v.string() }))).toBe(false);
  });
});

describe('SensitiveMask.isSensitive — путь через точку', () => {
  test('помеченное поле верхнего уровня', () => {
    expect(mask.isSensitive(State, 'title')).toBe(true);
  });

  test('непомеченное поле', () => {
    expect(mask.isSensitive(State, 'ownerId')).toBe(false);
  });

  test('вложенное помеченное поле под optional', () => {
    expect(mask.isSensitive(State, 'profile.phone')).toBe(true);
    expect(mask.isSensitive(State, 'profile.nick')).toBe(false);
  });

  test('лист с помеченным в поддереве: объект и массив VO', () => {
    expect(mask.isSensitive(State, 'profile')).toBe(true);
    expect(mask.isSensitive(State, 'contacts')).toBe(true);
  });

  test('путь вне схемы — нет', () => {
    expect(mask.isSensitive(State, 'missing')).toBe(false);
  });

  test('object_with_rest — ключ вне entries по схеме rest', () => {
    const schema = v.objectWithRest(
      { name: v.string() },
      F.sensitive(v.string()),
    );
    expect(mask.isSensitive(schema, 'extra')).toBe(true);
    expect(mask.isSensitive(schema, 'name')).toBe(false);
  });

  test('variant — поле помечено хотя бы в одной ветке', () => {
    const schema = v.variant('kind', [
      v.object({ kind: v.literal('a'), secret: F.sensitive(v.string()) }),
      v.object({ kind: v.literal('b'), secret: v.string() }),
    ]);
    expect(mask.isSensitive(schema, 'secret')).toBe(true);
    expect(mask.isSensitive(schema, 'kind')).toBe(false);
  });

  test('схема с withEntityDefaults — по её entries', () => {
    expect(mask.isSensitive(withEntityDefaults(State), 'title')).toBe(true);
  });
});
