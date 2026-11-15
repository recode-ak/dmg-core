import { describe, expect, it } from 'bun:test';
import {
  contributor,
  graphError,
  graphErrorCode,
  ToyEdgeKindInfos,
  ToyKinds,
  ToyNodeKindInfos,
  ToyProvider,
  toyEdge,
  toyKindsOnly,
  toyNode,
  toyProvider,
  visibleNode,
} from './graph.fixture';
import { GraphBuilder } from './graph-builder';
import { GraphError } from './graph-error';

function build(...providers: ToyProvider[]) {
  const builder = new GraphBuilder();
  for (const provider of providers) builder.add(provider);
  return builder.build();
}

const withContribution = (
  nodes: ReturnType<typeof toyNode>[],
  edges: ReturnType<typeof toyEdge>[] = [],
) => new ToyProvider('toy', '1.0.0', ToyKinds, { nodes, edges });

describe('GraphBuilder: узлы, рёбра, свойства', () => {
  it('узел после сборки несёт kind, id, label, description и props', () => {
    const node = build(toyProvider()).node('shop/food/bread');
    expect(node).toEqual({
      id: 'shop/food/bread',
      kind: 'item',
      label: 'Узел shop/food/bread',
      description: 'Описание shop/food/bread.',
      visible: false,
      parent: 'shop/food',
      provider: 'toy',
      props: { price: 3 },
    });
  });

  it('visible: true из входа сохраняется, явный false тоже', () => {
    const provider = withContribution([
      toyNode('shop', 'shop'),
      visibleNode('dept', 'shop/open', true),
      visibleNode('dept', 'shop/closed', false),
    ]);
    const graph = build(provider);
    expect(graph.node('shop/open')?.visible).toBe(true);
    expect(graph.node('shop/closed')?.visible).toBe(false);
    expect(graph.node('shop')?.visible).toBe(false);
  });

  it('ребро после сборки несёт kind, from, to и props', () => {
    const edge = build(toyProvider())
      .edges()
      .find((e) => e.kind === 'ships');
    expect(edge).toEqual({
      kind: 'ships',
      from: 'shop/tools/saw',
      to: 'depot/stock/pallet',
      provider: 'toy',
      props: { days: 2 },
    });
  });

  it('ошибка реестра по узлу доходит из build с узлом и поставщиком', () => {
    const second = contributor('second', {
      nodes: [toyNode('item', 'shop/food/jam', { price: 'x' })],
      edges: [],
    });
    const error = graphError(() => build(toyProvider(), second));
    expect(error.code).toBe('invalid-props');
    expect(error.message).toContain('shop/food/jam');
    expect(error.message).toContain('second');
    expect(error.cause).toBeInstanceOf(GraphError);
  });

  it('ошибка реестра по ребру доходит из build с ребром и поставщиком', () => {
    const second = contributor('second', {
      nodes: [],
      edges: [toyEdge('нет', 'shop/tools', 'vendor/part')],
    });
    const error = graphError(() => build(toyProvider(), second));
    expect(error.code).toBe('unknown-kind');
    expect(error.message).toContain('shop/tools');
    expect(error.message).toContain('vendor/part');
    expect(error.message).toContain('second');
  });

  it('вид, зарегистрированный позже добавленным поставщиком, доступен раньше добавленному', () => {
    const early = contributor('early', {
      nodes: [toyNode('dept', 'solo')],
      edges: [],
    });
    const graph = build(early, toyKindsOnly('kinds'));
    expect(graph.node('solo')?.provider).toBe('early');
  });

  it('порядок add не влияет на результат', () => {
    const extra = contributor('extra', {
      nodes: [toyNode('item', 'shop/food/jam', { price: 1 })],
      edges: [],
    });
    const a = build(toyProvider(), extra);
    const b = build(extra, toyProvider());
    expect(a.nodes()).toEqual(b.nodes());
    expect(a.edges()).toEqual(b.edges());
    expect(a.providers).toEqual(b.providers);
    expect(a.providers).toEqual([
      {
        name: 'extra',
        version: '1.0.0',
        nodeKinds: [],
        edgeKinds: [],
      },
      {
        name: 'toy',
        version: '1.0.0',
        nodeKinds: ToyNodeKindInfos,
        edgeKinds: ToyEdgeKindInfos,
      },
    ]);
  });
});

describe('GraphBuilder: родитель, поставщик, повторы', () => {
  it('родитель вне графа — unknown-parent', () => {
    const provider = withContribution([toyNode('dept', 'shop/food')]);
    expect(graphErrorCode(() => build(provider))).toBe('unknown-parent');
  });

  it('невалидный id узла — invalid-id', () => {
    const provider = withContribution([toyNode('shop', 'a b')]);
    expect(graphErrorCode(() => build(provider))).toBe('invalid-id');
  });

  it('повтор id в одном поставщике — duplicate-node', () => {
    const provider = withContribution([
      toyNode('shop', 'shop'),
      toyNode('shop', 'shop'),
    ]);
    expect(graphErrorCode(() => build(provider))).toBe('duplicate-node');
  });

  it('повтор id от двух поставщиков — duplicate-node', () => {
    const other = contributor('other', {
      nodes: [toyNode('shop', 'depot')],
      edges: [],
    });
    expect(graphErrorCode(() => build(toyProvider(), other))).toBe(
      'duplicate-node',
    );
  });

  it('повтор имени поставщика — duplicate-provider', () => {
    const builder = new GraphBuilder().add(toyProvider());
    expect(graphErrorCode(() => builder.add(toyKindsOnly('toy')))).toBe(
      'duplicate-provider',
    );
  });

  it('пустое имя поставщика — invalid-id', () => {
    const builder = new GraphBuilder();
    expect(graphErrorCode(() => builder.add(toyKindsOnly('')))).toBe(
      'invalid-id',
    );
  });

  it('provider у узла и ребра — имя поставившего; чужой вид от второго поставщика', () => {
    const second = contributor(
      'second',
      {
        nodes: [toyNode('item', 'shop/food/jam', { price: 1 })],
        edges: [toyEdge('uses', 'shop/food/jam', 'shop/food/bread')],
      },
      '2.0.0',
    );
    const graph = build(toyProvider(), second);
    expect(graph.node('shop/food/jam')?.provider).toBe('second');
    expect(graph.node('shop/food')?.provider).toBe('toy');
    expect(
      graph.edges().find((e) => e.from === 'shop/food/jam')?.provider,
    ).toBe('second');
    expect(graph.providers).toEqual([
      { name: 'second', version: '2.0.0', nodeKinds: [], edgeKinds: [] },
      {
        name: 'toy',
        version: '1.0.0',
        nodeKinds: ToyNodeKindInfos,
        edgeKinds: ToyEdgeKindInfos,
      },
    ]);
  });
});

describe('GraphBuilder: рёбра и внешние ссылки', () => {
  it('внешняя ссылка не роняет сборку', () => {
    const graph = build(toyProvider());
    expect(
      graph
        .edges()
        .some(
          (e) => e.from === 'shop/tools/saw' && e.to === 'vendor/catalog/blade',
        ),
    ).toBe(true);
  });

  it('ребро от неизвестного узла — unknown-source', () => {
    const provider = withContribution(
      [toyNode('shop', 'shop')],
      [toyEdge('uses', 'ghost', 'shop')],
    );
    expect(graphErrorCode(() => build(provider))).toBe('unknown-source');
  });

  it('невалидный from — invalid-id раньше unknown-source', () => {
    const provider = withContribution(
      [toyNode('shop', 'shop')],
      [toyEdge('uses', 'a b', 'shop')],
    );
    expect(graphErrorCode(() => build(provider))).toBe('invalid-id');
  });

  it('невалидный to — invalid-id', () => {
    const provider = withContribution(
      [toyNode('shop', 'shop')],
      [toyEdge('uses', 'shop', 'a b')],
    );
    expect(graphErrorCode(() => build(provider))).toBe('invalid-id');
  });

  it('повтор тройки (kind, from, to) — duplicate-edge', () => {
    const provider = withContribution(
      [toyNode('shop', 'shop')],
      [toyEdge('uses', 'shop', 'x'), toyEdge('uses', 'shop', 'x')],
    );
    expect(graphErrorCode(() => build(provider))).toBe('duplicate-edge');
  });

  it('рёбра разных видов с теми же концами — не повтор', () => {
    const provider = withContribution(
      [toyNode('shop', 'shop')],
      [
        toyEdge('uses', 'shop', 'x'),
        toyEdge('ships', 'shop', 'x', { days: 1 }),
      ],
    );
    expect(build(provider).edges()).toHaveLength(2);
  });

  it('from — узел другого поставщика допустим', () => {
    const other = contributor('other', {
      nodes: [],
      edges: [toyEdge('uses', 'shop', 'depot')],
    });
    expect(
      build(toyProvider(), other)
        .edges()
        .some((e) => e.provider === 'other'),
    ).toBe(true);
  });
});
