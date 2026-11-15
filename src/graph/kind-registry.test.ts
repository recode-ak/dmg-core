import { describe, expect, it } from 'bun:test';
import { graphErrorCode, ToyKinds } from './graph.fixture';
import { KindRegistry } from './kind-registry';

function toyRegistry(): KindRegistry {
  const registry = new KindRegistry();
  registry.register('toy', ToyKinds);
  return registry;
}

describe('KindRegistry', () => {
  it('отдаёт вид узла и ребра вместе с поставщиком', () => {
    const registry = toyRegistry();
    expect(registry.node('dept')?.provider).toBe('toy');
    expect(registry.edge('ships')?.provider).toBe('toy');
    expect(registry.node('нет')).toBeUndefined();
  });

  it('повтор вида узла тем же поставщиком — duplicate-kind', () => {
    const registry = toyRegistry();
    expect(graphErrorCode(() => registry.register('toy', ToyKinds))).toBe(
      'duplicate-kind',
    );
  });

  it('повтор вида узла другим поставщиком — duplicate-kind', () => {
    const registry = toyRegistry();
    const other = {
      nodes: [{ kind: 'dept', label: 'Другой', description: 'Повтор.' }],
      edges: [],
    };
    expect(graphErrorCode(() => registry.register('other', other))).toBe(
      'duplicate-kind',
    );
  });

  it('повтор вида ребра — duplicate-kind', () => {
    const registry = toyRegistry();
    const other = {
      nodes: [],
      edges: [{ kind: 'uses', label: 'Другое', description: 'Повтор.' }],
    };
    expect(graphErrorCode(() => registry.register('other', other))).toBe(
      'duplicate-kind',
    );
  });

  it('одно имя у вида узла и вида ребра — не ошибка', () => {
    const registry = new KindRegistry();
    const spec = { kind: 'link', label: 'Связь', description: 'Имя общее.' };
    registry.register('toy', { nodes: [spec], edges: [spec] });
    expect(registry.node('link')).toBeDefined();
    expect(registry.edge('link')).toBeDefined();
  });

  it('имя вида не по правилу сегмента — invalid-id', () => {
    const registry = new KindRegistry();
    const bad = { kind: 'a b', label: 'Плохой', description: 'Пробел.' };
    expect(
      graphErrorCode(() =>
        registry.register('toy', { nodes: [bad], edges: [] }),
      ),
    ).toBe('invalid-id');
    expect(
      graphErrorCode(() =>
        registry.register('toy', { nodes: [], edges: [bad] }),
      ),
    ).toBe('invalid-id');
  });

  it('свойства по схеме сохраняются', () => {
    const registry = toyRegistry();
    expect(registry.nodeProps('item', { price: 3 })).toEqual({ price: 3 });
    expect(registry.edgeProps('ships', { days: 2 })).toEqual({ days: 2 });
  });

  it('вид без схемы даёт пустые свойства', () => {
    const registry = toyRegistry();
    expect(registry.nodeProps('dept', undefined)).toEqual({});
    expect(registry.edgeProps('uses', undefined)).toEqual({});
  });

  it('свойства у вида без схемы — invalid-props', () => {
    const registry = toyRegistry();
    expect(graphErrorCode(() => registry.nodeProps('dept', { a: 1 }))).toBe(
      'invalid-props',
    );
    expect(graphErrorCode(() => registry.edgeProps('uses', { a: 1 }))).toBe(
      'invalid-props',
    );
  });

  it('неверный тип свойства узла — invalid-props', () => {
    const registry = toyRegistry();
    expect(
      graphErrorCode(() => registry.nodeProps('item', { price: 'x' })),
    ).toBe('invalid-props');
  });

  it('нет обязательного ключа свойств ребра — invalid-props', () => {
    const registry = toyRegistry();
    expect(graphErrorCode(() => registry.edgeProps('ships', {}))).toBe(
      'invalid-props',
    );
  });

  it('лишний ключ при strictObject — invalid-props', () => {
    const registry = toyRegistry();
    expect(
      graphErrorCode(() => registry.nodeProps('item', { price: 1, extra: 1 })),
    ).toBe('invalid-props');
    expect(
      graphErrorCode(() => registry.edgeProps('ships', { days: 1, extra: 1 })),
    ).toBe('invalid-props');
  });

  it('свойства незарегистрированного вида — unknown-kind', () => {
    const registry = toyRegistry();
    expect(graphErrorCode(() => registry.nodeProps('нет', undefined))).toBe(
      'unknown-kind',
    );
    expect(graphErrorCode(() => registry.edgeProps('нет', undefined))).toBe(
      'unknown-kind',
    );
  });
});
