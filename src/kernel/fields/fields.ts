import * as v from 'valibot';
import type { Timestamp } from '../time/timestamp';

const ZONE = /([zZ]|[+-]\d{2}:?\d{2})$/;

// Legacy-даты (`YYYY-MM-DDTHH:mm`) хранились в UTC без зоны.
function parseIso(value: string): Timestamp {
  return Date.parse(ZONE.test(value) ? value : `${value}Z`);
}

function timestamp(label: string) {
  return v.pipe(
    v.union([
      v.pipe(v.number(), v.integer()),
      v.pipe(v.string(), v.isoDateTime()),
      v.pipe(v.string(), v.isoTimestamp()),
    ]),
    v.description(`Время ${label}`),
    v.transform(
      (value): Timestamp =>
        typeof value === 'number' ? value : parseIso(value),
    ),
  );
}

function uuid(label: string) {
  return v.pipe(v.string(), v.uuid(), v.description(`Идентификатор ${label}`));
}

function string(label: string) {
  return v.pipe(v.string(), v.nonEmpty(), v.description(label));
}

function int(label: string) {
  return v.pipe(v.number(), v.integer(), v.description(label));
}

function boolean(label: string) {
  return v.pipe(v.boolean(), v.description(label));
}

function picklist<const T extends readonly [string, ...string[]]>(
  options: T,
  label: string,
) {
  return v.pipe(v.picklist(options), v.description(label));
}

/**
 * Ожидаемая версия во входе UC (D-57): версия агрегата, которую видел
 * клиент. Необязательная и без подстановки — не прислана, значит сверки нет.
 */
function expectedVersion(label: string) {
  return v.pipe(
    v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    v.description(`Версия ${label}, которую видел клиент`),
  );
}

/**
 * Пометка персональных данных (D-85): разбор и тип выхода — как у `schema`,
 * в лог операций значение не попадает (`SensitiveMask`). Метка — в схеме,
 * поэтому переживает `v.pick` и перенос поля в другую схему.
 */
function sensitive<S extends v.GenericSchema>(schema: S) {
  return v.pipe(schema, v.metadata({ sensitive: true }));
}

/**
 * Базовые поля схем (DOM-11): описание ставится из метки.
 * `uuid`, `timestamp` и `expectedVersion` принимают метку в родительном
 * падеже: `F.uuid('задачи')`.
 */
export const F = {
  uuid,
  timestamp,
  string,
  int,
  boolean,
  picklist,
  expectedVersion,
  sensitive,
};

/**
 * Версия entity для оптимистичной блокировки (D-36): растёт с каждой
 * мутацией. Записи до появления поля читаются как версия 0.
 */
function version() {
  return v.pipe(
    v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
    v.description('Версия сущности (оптимистичная блокировка)'),
  );
}

/** Поля, общие для всех entity. */
export const BaseEntityFields = {
  uuid: uuid('сущности'),
  createdAt: timestamp('создания'),
  updatedAt: timestamp('изменения'),
  version: version(),
};

/**
 * Копия схемы state: запись старого формата без `updatedAt` читается как
 * `updatedAt = createdAt`. Фолбэк — на уровне схемы, потому что поле соседей
 * не видит; меняется только разбор. Производные схемы его наследуют, схема,
 * собранная заново из `entries`, — теряет.
 * @see src/kernel/fields/fields.test.ts
 */
export function withEntityDefaults<S extends v.GenericSchema>(schema: S): S {
  const original = schema['~run'];
  const derived: S = {
    ...schema,
    '~run'(dataset, config) {
      const value = hasUpdatedAt(this)
        ? fillUpdatedAt(dataset.value)
        : dataset.value;
      return original.call(this, { ...dataset, value }, config);
    },
  };
  return {
    ...derived,
    '~standard': {
      ...schema['~standard'],
      validate: (value: unknown) =>
        derived['~run']({ value }, v.getGlobalConfig()) as ReturnType<
          S['~standard']['validate']
        >,
    },
  };
}

/** Есть ли `updatedAt` среди полей схемы; у схем без `entries` — да. */
function hasUpdatedAt(schema: object): boolean {
  if (!('entries' in schema)) return true;
  const { entries } = schema;
  return (
    typeof entries === 'object' && entries !== null && 'updatedAt' in entries
  );
}

function fillUpdatedAt(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (!('createdAt' in value) || value.createdAt === undefined) return value;
  if ('updatedAt' in value && value.updatedAt !== undefined) return value;
  return { ...value, updatedAt: value.createdAt };
}
