import type * as v from 'valibot';
import { BaseEntityFields } from '#core/kernel/fields/fields';
import { SensitiveMask } from '#core/kernel/schema/sensitive-mask';
import type { RedactedChange } from './operation-record';

/**
 * Изменённый лист state: путь через точку, было и стало. `from: undefined` —
 * поля не было (в JSONL ключ пропадёт). В JSONL значение больше порога —
 * `ValueDigest`.
 */
export type FieldChange = {
  readonly path: string;
  readonly from: unknown;
  readonly to: unknown;
};

/** Служебные поля entity: их изменение видно по версиям записи. */
const SKIPPED = new Set(Object.keys(BaseEntityFields));

/**
 * Патч записи агрегата для лога операций (D-85): изменённые листы state.
 * Объекты разбираются по полям, массив и примитив — лист; созданный агрегат
 * (базы нет) — поля верхнего уровня. Чувствительный лист — `redacted` без
 * значений и хеша: хеш короткого секрета подбирается перебором.
 * @see src/app/oplog/field-diff.test.ts
 */
export class FieldDiff {
  private readonly mask = new SensitiveMask();

  constructor(private readonly state: v.GenericSchema) {}

  /** Изменения от `baseline` к `current`; порядок — не контракт. */
  between(
    baseline: object | undefined,
    current: object,
  ): (FieldChange | RedactedChange)[] {
    const out: (FieldChange | RedactedChange)[] = [];
    if (baseline === undefined) {
      const schemas = this.mask.branches(this.state, current);
      for (const [key, to] of Object.entries(current)) {
        if (SKIPPED.has(key) || to === undefined) continue;
        out.push(this.leaf(this.fieldOf(schemas, key), key, undefined, to));
      }
      return out;
    }
    const schemas = this.mask.branches(this.state, baseline, current);
    for (const key of keysOf(baseline, current)) {
      if (SKIPPED.has(key)) continue;
      const from = read(baseline, key);
      const to = read(current, key);
      this.walk(this.fieldOf(schemas, key), key, from, to, out);
    }
    return out;
  }

  /**
   * Схемы — кандидаты поля: у `variant`/`union` ветка может быть не одна,
   * поле скрыто, если помечено хотя бы в одной.
   */
  private walk(
    schemas: readonly v.GenericSchema[],
    path: string,
    from: unknown,
    to: unknown,
    out: (FieldChange | RedactedChange)[],
  ): void {
    if (same(from, to)) return;
    const branches = schemas.flatMap((s) => this.mask.branches(s, from, to));
    const nested =
      branches.length > 0 &&
      branches.every((s) => this.mask.isObject(s)) &&
      isObject(from) &&
      isObject(to);
    if (!nested) {
      out.push(this.leaf(branches, path, from, to));
      return;
    }
    for (const key of keysOf(from, to)) {
      const child = this.fieldOf(branches, key);
      this.walk(child, `${path}.${key}`, from[key], to[key], out);
    }
  }

  private fieldOf(
    schemas: readonly v.GenericSchema[],
    key: string,
  ): v.GenericSchema[] {
    return schemas.flatMap((s) => this.mask.field(s, key) ?? []);
  }

  private leaf(
    schemas: readonly v.GenericSchema[],
    path: string,
    from: unknown,
    to: unknown,
  ): FieldChange | RedactedChange {
    if (schemas.some((s) => this.mask.containsSensitive(s))) {
      return { path, redacted: true };
    }
    return { path, from, to };
  }
}

function keysOf(a: object, b: object): Set<string> {
  return new Set([...Object.keys(a), ...Object.keys(b)]);
}

function read(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Структурное равенство значений state (JSON-подобных). */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => same(item, b[i]))
    );
  }
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) => Object.hasOwn(right, key) && same(left[key], right[key]),
  );
}
