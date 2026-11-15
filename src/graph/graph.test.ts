import { describe, expect, it } from 'bun:test';
import { ToyKinds, ToyProvider, toyGraph, toyNode } from './graph.fixture';
import { GraphBuilder } from './graph-builder';

const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);

describe('Graph: чтение', () => {
  it('nodes — в каноническом порядке (обход в глубину)', () => {
    expect(ids(toyGraph().nodes())).toEqual([
      'depot',
      'depot/stock',
      'depot/stock/pallet',
      'shop',
      'shop/food',
      'shop/food/bread',
      'shop/food/milk',
      'shop/tools',
      'shop/tools/saw',
    ]);
  });

  it('порядок узлов посегментный, по кодовым единицам', () => {
    const provider = new ToyProvider('toy', '1.0.0', ToyKinds, {
      nodes: [
        toyNode('shop', 'a-b'),
        toyNode('shop', 'a'),
        toyNode('dept', 'a/b'),
        toyNode('shop', 'B'),
      ],
      edges: [],
    });
    const graph = new GraphBuilder().add(provider).build();
    expect(ids(graph.nodes())).toEqual(['B', 'a', 'a/b', 'a-b']);
  });

  it('edges — по from, kind, to', () => {
    const keys = toyGraph()
      .edges()
      .map((e) => `${e.from} ${e.kind} ${e.to}`);
    expect(keys).toEqual([
      'shop/food/bread uses shop/food/milk',
      'shop/food/bread uses shop/tools/saw',
      'shop/food/milk uses shop/tools/saw',
      'shop/tools uses shop/food',
      'shop/tools/saw ships depot/stock/pallet',
      'shop/tools/saw uses vendor/catalog/blade',
    ]);
  });

  it('parent — id без последнего сегмента, у корня поля нет', () => {
    const graph = toyGraph();
    expect(graph.node('shop/food/bread')?.parent).toBe('shop/food');
    const root = graph.node('shop');
    expect(root).toBeDefined();
    expect(Object.keys(root ?? {})).not.toContain('parent');
  });

  it('node неизвестного id — undefined', () => {
    expect(toyGraph().node('нет')).toBeUndefined();
  });

  it('roots отдаёт оба корня', () => {
    expect(ids(toyGraph().roots())).toEqual(['depot', 'shop']);
  });

  it('children — прямые дети в каноническом порядке', () => {
    const graph = toyGraph();
    expect(ids(graph.children('shop'))).toEqual(['shop/food', 'shop/tools']);
    expect(ids(graph.children('shop/food'))).toEqual([
      'shop/food/bread',
      'shop/food/milk',
    ]);
    expect(graph.children('shop/food/bread')).toEqual([]);
  });

  it('ancestors — от родителя к корню', () => {
    expect(ids(toyGraph().ancestors('shop/food/bread'))).toEqual([
      'shop/food',
      'shop',
    ]);
    expect(toyGraph().ancestors('shop')).toEqual([]);
  });

  it('providers — имя и версия', () => {
    expect(toyGraph().providers).toEqual([{ name: 'toy', version: '1.0.0' }]);
  });
});

describe('Graph: внешние ссылки', () => {
  it('externals — внешние id без повторов в каноническом порядке', () => {
    const provider = new ToyProvider('toy', '1.0.0', ToyKinds, {
      nodes: [toyNode('shop', 'shop')],
      edges: [
        { kind: 'uses', from: 'shop', to: 'zeta/x' },
        { kind: 'ships', from: 'shop', to: 'zeta/x', props: { days: 1 } },
        { kind: 'uses', from: 'shop', to: 'alpha' },
      ],
    });
    const graph = new GraphBuilder().add(provider).build();
    expect(graph.externals()).toEqual(['alpha', 'zeta/x']);
  });

  it('externals — внешняя ссылка игрушечного графа', () => {
    expect(toyGraph().externals()).toEqual(['vendor/catalog/blade']);
  });

  it('externals пуст, если внешних нет', () => {
    const provider = new ToyProvider('toy', '1.0.0', ToyKinds, {
      nodes: [toyNode('shop', 'shop'), toyNode('dept', 'shop/a')],
      edges: [{ kind: 'uses', from: 'shop', to: 'shop/a' }],
    });
    expect(new GraphBuilder().add(provider).build().externals()).toEqual([]);
  });
});
