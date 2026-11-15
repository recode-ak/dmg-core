import { describe, expect, it } from 'bun:test';
import { graphErrorCode } from './graph.fixture';
import { GraphId } from './graph-id';

describe('GraphId', () => {
  it('разбирает путь на сегменты', () => {
    const id = GraphId.parse('shop/food/bread');
    expect(id.segments).toEqual(['shop', 'food', 'bread']);
    expect(id.toString()).toBe('shop/food/bread');
  });

  it('допускает точку, дефис и регистр в сегменте', () => {
    expect(GraphId.parse('app/peer-review/tasks.json/Task_1').segments).toEqual(
      ['app', 'peer-review', 'tasks.json', 'Task_1'],
    );
  });

  it('root даёт один сегмент', () => {
    expect(GraphId.root('shop').toString()).toBe('shop');
  });

  it('child добавляет сегмент', () => {
    expect(GraphId.root('shop').child('food').toString()).toBe('shop/food');
  });

  it('parent — id без последнего сегмента, у корня нет', () => {
    expect(GraphId.parse('shop/food/bread').parent()?.toString()).toBe(
      'shop/food',
    );
    expect(GraphId.parse('shop').parent()).toBeUndefined();
  });

  it('ancestors — от родителя к корню', () => {
    const ancestors = GraphId.parse('shop/food/bread')
      .ancestors()
      .map((id) => id.toString());
    expect(ancestors).toEqual(['shop/food', 'shop']);
    expect(GraphId.parse('shop').ancestors()).toEqual([]);
  });

  it('prefix — первые depth сегментов', () => {
    const id = GraphId.parse('shop/food/bread');
    expect(id.prefix(1).toString()).toBe('shop');
    expect(id.prefix(2).toString()).toBe('shop/food');
  });

  it('prefix длиннее id — сам id', () => {
    expect(GraphId.parse('shop').prefix(3).toString()).toBe('shop');
  });

  it('prefix: глубина не целое ≥ 1 — invalid-depth', () => {
    const id = GraphId.parse('shop/food');
    for (const depth of [0, -1, 1.5]) {
      expect(graphErrorCode(() => id.prefix(depth))).toBe('invalid-depth');
    }
  });

  it('under добавляет приставку', () => {
    const id = GraphId.parse('shop/food');
    expect(id.under(GraphId.parse('chain/branches')).toString()).toBe(
      'chain/branches/shop/food',
    );
  });

  it('невалидные сегменты — invalid-id', () => {
    for (const text of ['', 'a//b', 'a/..', 'a/.', 'a b', 'a?', '/a', 'a/']) {
      expect(graphErrorCode(() => GraphId.parse(text))).toBe('invalid-id');
    }
  });

  it('root и child проверяют сегмент — invalid-id', () => {
    expect(graphErrorCode(() => GraphId.root('a/b'))).toBe('invalid-id');
    expect(graphErrorCode(() => GraphId.root('shop').child('..'))).toBe(
      'invalid-id',
    );
  });

  it('compare сравнивает посегментно: a < a/b < a-b', () => {
    expect(GraphId.compare('a', 'a/b')).toBeLessThan(0);
    expect(GraphId.compare('a/b', 'a-b')).toBeLessThan(0);
    expect(GraphId.compare('a-b', 'a/b')).toBeGreaterThan(0);
    expect(GraphId.compare('a/b', 'a/b')).toBe(0);
  });

  it('compare сравнивает кодовые единицы: регистр значим', () => {
    expect(GraphId.compare('B', 'a')).toBeLessThan(0);
  });
});
