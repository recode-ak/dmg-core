import type * as v from 'valibot';

/** Чем заменяется помеченное значение в логе операций. */
export const REDACTED = '[redacted]';

/** Схема valibot в обходе: вид и дочерние схемы читаются по `type`. */
type Node = v.GenericSchema & Readonly<Record<string, unknown>>;

const OBJECTS = new Set([
  'object',
  'loose_object',
  'strict_object',
  'object_with_rest',
]);

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'nullish',
  'exact_optional',
  'undefinedable',
  'non_optional',
  'non_nullable',
  'non_nullish',
]);

const TUPLES = new Set([
  'tuple',
  'loose_tuple',
  'strict_tuple',
  'tuple_with_rest',
]);

/** Схема, которую обход не разбирает, а в ней может быть помеченное. */
class UnsupportedSchema extends Error {
  constructor(type: string) {
    super(`вид схемы ${type} не разбирается`);
    this.name = 'UnsupportedSchema';
  }
}

/** Пометки `containsSensitive` по схеме: схема неизменна — кэш на процесс. */
const contains = new WeakMap<object, boolean>();

/**
 * Маскирование полей, помеченных `F.sensitive`, для лога операций (D-86):
 * копия значения с `'[redacted]'` вместо помеченных листов, остальное и
 * ключи вне схемы — как есть. Значение берётся «как пришло», без разбора:
 * форма выхода после `transform` (`F.timestamp`) маскируется по той же
 * схеме. Неразбираемый вид (`lazy` и т. п.) — значение целиком
 * `'[redacted]'` и `warn`.
 * @see src/kernel/schema/sensitive-mask.test.ts
 */
export class SensitiveMask {
  constructor(private readonly warn?: (message: string) => void) {}

  /** Копия `value` с замаскированными полями; исходное не меняется. */
  apply(schema: v.GenericSchema, value: unknown): unknown {
    try {
      return this.mask(schema as Node, value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.warn?.(`Маскирование: ${reason} — значение скрыто целиком`);
      return REDACTED;
    }
  }

  /** Есть ли пометка в схеме или её поддереве; неразбираемый вид — да. */
  containsSensitive(schema: v.GenericSchema): boolean {
    const known = contains.get(schema);
    if (known !== undefined) return known;
    const found = this.search(schema as Node);
    contains.set(schema, found);
    return found;
  }

  /**
   * Чувствительно ли поле по пути через точку: помечено само, лежит под
   * помеченным или содержит помеченное в поддереве; у `variant`/`union` —
   * хотя бы в одной ветке. Путь вне схемы — нет.
   */
  isSensitive(schema: v.GenericSchema, path: string): boolean {
    let nodes: readonly v.GenericSchema[] = [schema];
    for (const key of path.split('.')) {
      const next: v.GenericSchema[] = [];
      for (const node of nodes.flatMap((n) => this.branches(n))) {
        if (!this.isObject(node)) {
          if (this.containsSensitive(node)) return true;
          continue;
        }
        const child = this.field(node, key);
        if (child !== undefined) next.push(child);
      }
      nodes = next;
    }
    return nodes.some((node) => this.containsSensitive(node));
  }

  /**
   * Ветки схемы под обёртками: у `variant` — по ключу каждого из `values`,
   * не нашлась — все; у `union` — все; иначе — сама схема. Помеченная
   * обёртка ветвей не раскрывает.
   */
  branches(
    schema: v.GenericSchema,
    ...values: readonly unknown[]
  ): readonly v.GenericSchema[] {
    let node = schema as Node;
    for (;;) {
      if (isMarked(node)) return [node];
      if (node.type === 'variant' || node.type === 'union') break;
      const inner = unwrapped(node);
      if (inner === undefined) return [schema];
      node = inner;
    }
    const options =
      this.chosen(node, values.filter(isPlainObject)) ??
      (node.options as readonly Node[]);
    return [...new Set(options.flatMap((o) => this.branches(o, ...values)))];
  }

  /** Ветки `variant` по значениям; хоть одна не нашлась — `undefined`. */
  private chosen(
    node: Node,
    values: readonly unknown[],
  ): readonly Node[] | undefined {
    if (node.type !== 'variant' || values.length === 0) return undefined;
    const options: Node[] = [];
    for (const value of values) {
      const option = this.variantOption(node, value);
      if (option === undefined) return undefined;
      options.push(option);
    }
    return options;
  }

  /** Объектная схема под обёртками и не помечена целиком. */
  isObject(schema: v.GenericSchema): boolean {
    return objectNode(schema as Node) !== undefined;
  }

  /** Схема поля объекта по ключу: из `entries`, иначе `rest`; нет — `undefined`. */
  field(schema: v.GenericSchema, key: string): v.GenericSchema | undefined {
    const node = objectNode(schema as Node);
    if (node === undefined) return undefined;
    const entries = node.entries as Readonly<Record<string, v.GenericSchema>>;
    if (Object.hasOwn(entries, key)) return entries[key];
    return node.rest as v.GenericSchema | undefined;
  }

  private mask(node: Node, value: unknown): unknown {
    if (isMarked(node)) return REDACTED;
    if (!this.containsSensitive(node)) return value;
    const inner = unwrapped(node);
    if (inner !== undefined) return this.mask(inner, value);
    if (OBJECTS.has(node.type)) return this.maskObject(node, value);
    if (node.type === 'array') return this.maskArray(node, value);
    if (TUPLES.has(node.type)) return this.maskTuple(node, value);
    if (node.type === 'record') return this.maskRecord(node, value);
    if (node.type === 'variant') return this.maskVariant(node, value);
    // Ветку union по значению «как пришло» не выбрать: пометка хотя бы в
    // одной ветке скрывает значение целиком.
    if (node.type === 'union') return REDACTED;
    throw new UnsupportedSchema(node.type);
  }

  private maskObject(node: Node, value: unknown): unknown {
    if (!isPlainObject(value)) return value;
    const entries = node.entries as Readonly<Record<string, Node>>;
    const rest = node.rest as Node | undefined;
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      const schema = Object.hasOwn(entries, key) ? entries[key] : rest;
      out[key] = schema === undefined ? field : this.mask(schema, field);
    }
    return out;
  }

  private maskArray(node: Node, value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    const item = node.item as Node;
    return value.map((element) => this.mask(item, element));
  }

  private maskTuple(node: Node, value: unknown): unknown {
    if (!Array.isArray(value)) return value;
    const items = node.items as readonly Node[];
    const rest = node.rest as Node | undefined;
    return value.map((element, i) => {
      const schema = items[i] ?? rest;
      return schema === undefined ? element : this.mask(schema, element);
    });
  }

  private maskRecord(node: Node, value: unknown): unknown {
    if (!isPlainObject(value)) return value;
    const schema = node.value as Node;
    const out: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      out[key] = this.mask(schema, field);
    }
    return out;
  }

  /** Ветка — по ключу варианта; не нашлась — значение скрыто целиком. */
  private maskVariant(node: Node, value: unknown): unknown {
    const option = this.variantOption(node, value);
    return option === undefined ? REDACTED : this.mask(option, value);
  }

  private variantOption(node: Node, value: unknown): Node | undefined {
    if (!isPlainObject(value)) return undefined;
    const key = node.key as string;
    for (const option of node.options as readonly Node[]) {
      if (option.type === 'variant') {
        const nested = this.variantOption(option, value);
        if (nested !== undefined) return nested;
        continue;
      }
      const discriminator = this.field(option, key);
      if (discriminator === undefined) continue;
      const parsed = discriminator['~run'](
        { value: value[key] },
        { abortEarly: true },
      );
      if (parsed.issues === undefined) return option;
    }
    return undefined;
  }

  private search(node: Node): boolean {
    if (isMarked(node)) return true;
    const children = childSchemas(node);
    if (children === undefined) return true;
    return children.some((child) => this.containsSensitive(child));
  }
}

/** Пометка `F.sensitive`: `metadata.sensitive` в любом элементе `pipe`. */
function isMarked(node: Node): boolean {
  const pipe = node.pipe as readonly Node[] | undefined;
  if (pipe === undefined) return false;
  return pipe.some(
    (item) =>
      item.type === 'metadata' &&
      (item.metadata as Record<string, unknown> | undefined)?.sensitive ===
        true,
  );
}

/** Объект под обёртками; помечен целиком или не объект — `undefined`. */
function objectNode(schema: Node): Node | undefined {
  let node = schema;
  for (;;) {
    if (isMarked(node)) return undefined;
    if (OBJECTS.has(node.type)) return node;
    const inner = unwrapped(node);
    if (inner === undefined) return undefined;
    node = inner;
  }
}

/** Схема под обёрткой (`pipe`, `optional`…); не обёртка — `undefined`. */
function unwrapped(node: Node): Node | undefined {
  const pipe = node.pipe as readonly Node[] | undefined;
  if (pipe !== undefined) return pipe[0];
  if (WRAPPERS.has(node.type)) return node.wrapped as Node;
  return undefined;
}

/**
 * Дочерние схемы известного вида; лист — пусто. `undefined` — вид с
 * дочерними схемами, которые обход не разбирает (`lazy`, `intersect`…).
 */
function childSchemas(node: Node): readonly Node[] | undefined {
  const inner = unwrapped(node);
  if (inner !== undefined) return [inner];
  const { type } = node;
  if (OBJECTS.has(type)) {
    const fields = Object.values(node.entries as Record<string, Node>);
    return node.rest === undefined ? fields : [...fields, node.rest as Node];
  }
  if (type === 'array') return [node.item as Node];
  if (TUPLES.has(type)) {
    const items = node.items as readonly Node[];
    return node.rest === undefined ? items : [...items, node.rest as Node];
  }
  if (type === 'record') return [node.value as Node];
  if (type === 'variant' || type === 'union') {
    return node.options as readonly Node[];
  }
  return hasNestedSchemas(node) ? undefined : [];
}

/** Есть ли у схемы неизвестного вида вложенные схемы или геттер схемы. */
function hasNestedSchemas(node: Node): boolean {
  return Object.entries(node).some(
    ([key, value]) =>
      key !== '~standard' &&
      (key === 'getter' ||
        isSchema(value) ||
        (Array.isArray(value) && value.some(isSchema))),
  );
}

function isSchema(value: unknown): boolean {
  return isPlainObject(value) && value.kind === 'schema';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
