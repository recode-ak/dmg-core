import { describe, expect, it } from 'bun:test';
import * as v from 'valibot';
import { toJsonSchema } from '../schema/json-schema';
import { BaseEntityFields, F, withEntityDefaults } from './fields';

const UUID = '0b6f8a52-3c1e-4d5a-9a43-1f7e2b9c8d10';

function descriptionOf(schema: v.GenericSchema): string | undefined {
  return v.getDescription(schema);
}

describe('F.timestamp', () => {
  const field = F.timestamp('создания');

  it('читает число как есть', () => {
    expect(v.parse(field, 1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('принимает ноль', () => {
    expect(v.parse(field, 0)).toBe(0);
  });

  it('отвергает ISO без зоны', () => {
    expect(v.safeParse(field, '2026-10-19T10:00').success).toBe(false);
  });

  it('отвергает ISO с зоной', () => {
    expect(v.safeParse(field, '2026-10-19T10:00:00.000Z').success).toBe(false);
  });

  it('отвергает произвольную строку', () => {
    expect(v.safeParse(field, 'вчера').success).toBe(false);
  });

  it('отвергает числовую строку', () => {
    expect(v.safeParse(field, '1700000000000').success).toBe(false);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['отрицательное', -1],
    ['дробное', 1.5],
  ])('отвергает %s', (_name, value) => {
    expect(v.safeParse(field, value).success).toBe(false);
  });

  it('описание из метки', () => {
    expect(descriptionOf(field)).toBe('Время создания');
  });
});

describe('F.uuid', () => {
  it('принимает UUID, отклоняет прочее, описание из метки', () => {
    const field = F.uuid('задачи');
    expect(v.parse(field, UUID)).toBe(UUID);
    expect(v.safeParse(field, 'x').success).toBe(false);
    expect(descriptionOf(field)).toBe('Идентификатор задачи');
  });
});

describe('простые поля', () => {
  it('метка становится описанием', () => {
    expect(descriptionOf(F.string('Название'))).toBe('Название');
    expect(descriptionOf(F.int('Порядок'))).toBe('Порядок');
    expect(descriptionOf(F.boolean('Выполнена'))).toBe('Выполнена');
    expect(descriptionOf(F.picklist(['a', 'b'], 'Статус'))).toBe('Статус');
  });

  it('F.string отклоняет пустую строку, F.int — дробь', () => {
    expect(v.safeParse(F.string('Название'), '').success).toBe(false);
    expect(v.safeParse(F.int('Порядок'), 1.5).success).toBe(false);
  });
});

describe('F.expectedVersion (D-57)', () => {
  const schema = v.object({ expectedVersion: F.expectedVersion('задачи') });

  it('целое ≥ 0 принимается как есть', () => {
    expect(v.parse(schema, { expectedVersion: 0 })).toEqual({
      expectedVersion: 0,
    });
    expect(v.parse(schema, { expectedVersion: 3 })).toEqual({
      expectedVersion: 3,
    });
  });

  it('необязательное: без поля — undefined, без подстановки', () => {
    const parsed = v.parse(schema, {});
    expect(parsed).toEqual({});
    expect('expectedVersion' in parsed).toBe(false);
  });

  it('отклоняет отрицательное, дробное и строку', () => {
    for (const value of [-1, 1.5, '1']) {
      expect(v.safeParse(schema, { expectedVersion: value }).success).toBe(
        false,
      );
    }
  });

  it('описание — из метки поля', () => {
    expect(descriptionOf(F.expectedVersion('задачи'))).toBe(
      'Версия задачи, которую видел клиент',
    );
  });
});

describe('BaseEntityFields', () => {
  it('uuid, createdAt, updatedAt; version без значения — 0', () => {
    const entity = v.object({ ...BaseEntityFields });
    const parsed = v.parse(entity, {
      uuid: UUID,
      createdAt: Date.UTC(2026, 9, 19, 10, 0),
      updatedAt: 5,
    });
    expect(parsed).toEqual({
      uuid: UUID,
      createdAt: Date.UTC(2026, 9, 19, 10, 0),
      updatedAt: 5,
      version: 0,
    });
  });
});

describe('withEntityDefaults', () => {
  const entity = withEntityDefaults(v.object({ ...BaseEntityFields }));
  const legacy = { uuid: UUID, createdAt: Date.UTC(2026, 9, 19, 10, 0) };

  it('запись без updatedAt читается как updatedAt = createdAt', () => {
    expect(v.parse(entity, legacy).updatedAt).toBe(
      Date.UTC(2026, 9, 19, 10, 0),
    );
  });

  it('updatedAt из записи не меняется', () => {
    expect(v.parse(entity, { ...legacy, updatedAt: 5 }).updatedAt).toBe(5);
  });

  it('Standard Schema тоже применяет фолбэк', () => {
    const res = entity['~standard'].validate(legacy);
    expect('value' in res && res.value.updatedAt).toBe(
      Date.UTC(2026, 9, 19, 10, 0),
    );
  });

  it('без createdAt — ошибка схемы, не подстановка', () => {
    expect(v.safeParse(entity, { uuid: UUID }).success).toBe(false);
  });

  it('вид схемы, поля и JSON Schema — как у исходной', () => {
    const source = v.object({ ...BaseEntityFields });
    const wrapped = withEntityDefaults(source);
    expect(wrapped.type).toBe('object');
    expect(wrapped.entries).toBe(source.entries);
    expect(toJsonSchema(wrapped)).toEqual(toJsonSchema(source));
  });

  it('ключ updatedAt со значением undefined — фолбэк', () => {
    expect(v.parse(entity, { ...legacy, updatedAt: undefined }).updatedAt).toBe(
      Date.UTC(2026, 9, 19, 10, 0),
    );
  });

  it('updatedAt: null — ошибка схемы, не подстановка', () => {
    expect(v.safeParse(entity, { ...legacy, updatedAt: null }).success).toBe(
      false,
    );
  });

  it('возвращает копию: исходная схема фолбэк не получает', () => {
    const source = v.object({ ...BaseEntityFields });
    expect(withEntityDefaults(source)).not.toBe(source);
    expect(v.safeParse(source, legacy).success).toBe(false);
  });

  it('схема, собранная заново из entries, фолбэк теряет', () => {
    const rebuilt = v.object({ ...entity.entries });
    expect(v.safeParse(rebuilt, legacy).success).toBe(false);
  });
});

describe('withEntityDefaults: производные схемы', () => {
  const entity = withEntityDefaults(
    v.object({ ...BaseEntityFields, name: F.string('Имя') }),
  );
  const legacy = { uuid: UUID, createdAt: 7, name: 'x' };

  it('v.pipe и v.array сохраняют фолбэк', () => {
    const piped = v.pipe(
      entity,
      v.check(() => true),
    );
    expect(v.parse(piped, legacy).updatedAt).toBe(7);
    expect(v.parse(v.array(entity), [legacy])[0]?.updatedAt).toBe(7);
  });

  it('v.pick проверяет только выбранные поля', () => {
    const picked = v.pick(entity, ['name']);
    expect(v.parse(picked, { name: 'x' })).toEqual({ name: 'x' });
    const res = picked['~standard'].validate({ name: 'x' });
    expect('issues' in res).toBe(false);
    expect('value' in res && res.value).toEqual({ name: 'x' });
  });

  it('v.omit проверяет оставшиеся поля и сохраняет фолбэк', () => {
    const omitted = v.omit(entity, ['uuid']);
    const { uuid: _, ...rest } = legacy;
    expect(v.parse(omitted, rest).updatedAt).toBe(7);
  });

  it('v.partial: поля необязательны, фолбэк сохраняется', () => {
    const partial = v.partial(entity);
    expect(v.parse(partial, {})).toEqual({});
    expect(v.parse(partial, { createdAt: 7 }).updatedAt).toBe(7);
  });

  it('strictObject без поля updatedAt — фолбэк не добавляет лишний ключ', () => {
    const strict = withEntityDefaults(v.strictObject({ ...BaseEntityFields }));
    const picked = v.pick(strict, ['createdAt']);
    expect(v.parse(picked, { createdAt: 7 })).toEqual({ createdAt: 7 });
  });
});

describe('JSON Schema', () => {
  it('все поля конвертируются, описания сохраняются', () => {
    const schema = v.object({
      ...BaseEntityFields,
      title: F.string('Название'),
      order: F.int('Порядок'),
      done: F.boolean('Выполнена'),
      status: F.picklist(['open', 'closed'], 'Статус'),
    });
    const json = toJsonSchema(schema);
    expect(json.properties?.createdAt).toMatchObject({
      description: 'Время создания',
    });
    expect(json.properties?.uuid).toMatchObject({ format: 'uuid' });
  });
});
