import { describe, expect, it } from 'bun:test';
import {
  contributor,
  ToyKinds,
  ToyProvider,
  toyEdge,
  toyGraph,
  toyInfo,
  toyNode,
} from './graph.fixture';
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

  it('providers — имя, версия и виды поставщика', () => {
    expect(toyGraph().providers).toEqual([toyInfo()]);
  });

  it('providers: виды отсортированы по kind, без схемы', () => {
    const [info] = toyGraph().providers;
    expect(Object.keys(info ?? {})).toEqual([
      'name',
      'version',
      'nodeKinds',
      'edgeKinds',
    ]);
    expect(info?.nodeKinds.map((k) => k.kind)).toEqual([
      'dept',
      'item',
      'shop',
    ]);
    expect(info?.edgeKinds.map((k) => k.kind)).toEqual(['ships', 'uses']);
    for (const kind of [
      ...(info?.nodeKinds ?? []),
      ...(info?.edgeKinds ?? []),
    ]) {
      expect(Object.keys(kind)).toEqual(['kind', 'label', 'description']);
    }
  });

  it('providers: порядок видов по кодовым единицам', () => {
    const provider = new ToyProvider(
      'toy',
      '1.0.0',
      {
        nodes: [
          { kind: 'b', label: 'b', description: 'b.' },
          { kind: 'a', label: 'a', description: 'a.' },
          { kind: 'B', label: 'B', description: 'B.' },
        ],
        edges: [],
      },
      { nodes: [], edges: [] },
    );
    const [info] = new GraphBuilder().add(provider).build().providers;
    expect(info?.nodeKinds.map((k) => k.kind)).toEqual(['B', 'a', 'b']);
  });

  it('providers: у поставщика без видов оба списка пусты', () => {
    const graph = new GraphBuilder()
      .add(contributor('empty', { nodes: [], edges: [] }))
      .build();
    expect(graph.providers).toEqual([
      { name: 'empty', version: '1.0.0', nodeKinds: [], edgeKinds: [] },
    ]);
  });
});

const keys = (edges: readonly { from: string; kind: string; to: string }[]) =>
  edges.map((e) => `${e.from} ${e.kind} ${e.to}`);

describe('Graph: чтения по узлу', () => {
  it('outgoing — рёбра из узла в каноническом порядке', () => {
    expect(keys(toyGraph().outgoing('shop/tools/saw'))).toEqual([
      'shop/tools/saw ships depot/stock/pallet',
      'shop/tools/saw uses vendor/catalog/blade',
    ]);
    expect(keys(toyGraph().outgoing('shop/food/bread'))).toEqual([
      'shop/food/bread uses shop/food/milk',
      'shop/food/bread uses shop/tools/saw',
    ]);
  });

  it('outgoing с видом — только рёбра этого вида', () => {
    expect(keys(toyGraph().outgoing('shop/tools/saw', 'ships'))).toEqual([
      'shop/tools/saw ships depot/stock/pallet',
    ]);
    expect(toyGraph().outgoing('shop/tools/saw', 'нет')).toEqual([]);
  });

  it('incoming — рёбра в узел в каноническом порядке (по from, kind)', () => {
    const provider = new ToyProvider('toy', '1.0.0', ToyKinds, {
      nodes: [
        toyNode('shop', 'a'),
        toyNode('shop', 'x'),
        toyNode('shop', 'target'),
      ],
      edges: [
        toyEdge('uses', 'x', 'target'),
        toyEdge('ships', 'x', 'target', { days: 1 }),
        toyEdge('uses', 'a', 'target'),
      ],
    });
    const graph = new GraphBuilder().add(provider).build();
    expect(keys(graph.incoming('target'))).toEqual([
      'a uses target',
      'x ships target',
      'x uses target',
    ]);
    expect(keys(graph.incoming('target', 'ships'))).toEqual(['x ships target']);
  });

  it('incoming узла игрушечного графа', () => {
    expect(keys(toyGraph().incoming('shop/tools/saw'))).toEqual([
      'shop/food/bread uses shop/tools/saw',
      'shop/food/milk uses shop/tools/saw',
    ]);
    expect(keys(toyGraph().incoming('shop/food'))).toEqual([
      'shop/tools uses shop/food',
    ]);
  });

  it('incoming внешнего id — рёбра, которые на него ссылаются', () => {
    expect(keys(toyGraph().incoming('vendor/catalog/blade'))).toEqual([
      'shop/tools/saw uses vendor/catalog/blade',
    ]);
  });

  it('неизвестный id — пустой массив в обоих чтениях', () => {
    expect(toyGraph().outgoing('нет')).toEqual([]);
    expect(toyGraph().incoming('нет')).toEqual([]);
    expect(toyGraph().outgoing('нет', 'uses')).toEqual([]);
    expect(toyGraph().incoming('нет', 'uses')).toEqual([]);
  });

  it('узел без рёбер — пустой массив', () => {
    expect(toyGraph().outgoing('depot')).toEqual([]);
    expect(toyGraph().incoming('depot')).toEqual([]);
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
