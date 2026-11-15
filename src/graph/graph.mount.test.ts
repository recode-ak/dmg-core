import { describe, expect, it } from 'bun:test';
import {
  contributor,
  graphError,
  graphErrorCode,
  hostGraph,
  hostProvider,
  rivalKinds,
  rivalProvider,
  ToyKinds,
  ToyProvider,
  toyContribution,
  toyEdge,
  toyGraph,
  toyInfo,
  toyNode,
  toyProvider,
  visibleNode,
} from './graph.fixture';
import { GraphBuilder } from './graph-builder';

const UNDER = 'chain/branches';

function mounted() {
  return hostGraph().mount(toyGraph(), UNDER);
}

describe('Graph.mount', () => {
  it('внутренние id получают приставку, корни становятся детьми under', () => {
    const graph = mounted();
    expect(graph.node('chain/branches/shop/food/bread')?.parent).toBe(
      'chain/branches/shop/food',
    );
    expect(graph.node('chain/branches/shop')?.parent).toBe(UNDER);
    expect(graph.node('chain/branches/depot')?.parent).toBe(UNDER);
    expect(graph.node('shop/food/bread')).toBeUndefined();
  });

  it('внешний id остаётся как есть и остаётся в externals()', () => {
    const graph = mounted();
    expect(graph.edges().some((e) => e.to === 'vendor/catalog/blade')).toBe(
      true,
    );
    expect(graph.externals()).toContain('vendor/catalog/blade');
  });

  it('смонтированный граф сохраняет связность', () => {
    const graph = mounted();
    for (const edge of graph.edges()) {
      expect(graph.node(edge.from)).toBeDefined();
    }
    const internal = graph
      .edges()
      .filter(
        (e) =>
          e.from.startsWith(`${UNDER}/`) && e.to !== 'vendor/catalog/blade',
      );
    expect(internal.length).toBe(5);
    for (const edge of internal) {
      expect(graph.node(edge.to)).toBeDefined();
    }
    expect(
      graph.ancestors('chain/branches/shop/food/bread').map((n) => n.id),
    ).toEqual([
      'chain/branches/shop/food',
      'chain/branches/shop',
      'chain/branches',
      'chain',
    ]);
    const lifted = graph
      .liftToKind('dept')
      .map((e) => `${e.from} ${e.kind} ${e.to}`);
    expect(lifted).toContain(
      'chain/branches/shop/food uses chain/branches/shop/tools',
    );
    expect(lifted).toContain(
      'chain/branches/shop/tools uses chain/branches/shop/food',
    );
  });

  it('ссылка хозяина на будущий узел до монтирования внешняя, после — разрешена', () => {
    const target = 'chain/branches/shop/tools/saw';
    expect(hostGraph().externals()).toEqual([target]);
    const graph = mounted();
    expect(graph.node(target)).toBeDefined();
    expect(graph.externals()).not.toContain(target);
    expect(graph.edges().some((e) => e.from === UNDER && e.to === target)).toBe(
      true,
    );
  });

  it('provider элементов сохранён, поставщики объединены без повторов', () => {
    const child = new GraphBuilder()
      .add(toyProvider())
      .add(
        contributor(
          'extra',
          {
            nodes: [toyNode('item', 'depot/stock/crate', { price: 1 })],
            edges: [],
          },
          '0.1.0',
        ),
      )
      .build();
    const graph = hostGraph().mount(child, UNDER);
    expect(graph.node('chain/branches/depot/stock/crate')?.provider).toBe(
      'extra',
    );
    expect(graph.node('chain/branches/shop')?.provider).toBe('toy');
    expect(graph.providers).toEqual([
      { name: 'extra', version: '0.1.0', nodeKinds: [], edgeKinds: [] },
      toyInfo(),
    ]);
  });

  it('две версии одного поставщика остаются двумя записями providers', () => {
    const child = new GraphBuilder()
      .add(new ToyProvider('toy', '2.0.0', ToyKinds, toyContribution()))
      .build();
    expect(hostGraph().mount(child, UNDER).providers).toEqual([
      toyInfo('1.0.0'),
      toyInfo('2.0.0'),
    ]);
  });

  it('внешний to дочернего, совпавший с узлом хозяина, после монтирования разрешён', () => {
    const child = new GraphBuilder()
      .add(
        new ToyProvider('toy', '1.0.0', ToyKinds, {
          nodes: [toyNode('shop', 'shop')],
          edges: [toyEdge('uses', 'shop', 'chain')],
        }),
      )
      .build();
    expect(child.externals()).toEqual(['chain']);
    const graph = hostGraph().mount(child, UNDER);
    expect(
      graph
        .edges()
        .some((e) => e.from === 'chain/branches/shop' && e.to === 'chain'),
    ).toBe(true);
    expect(graph.externals()).not.toContain('chain');
  });

  it('visible узлов child сохраняется при монтировании', () => {
    const child = new GraphBuilder()
      .add(
        new ToyProvider('toy', '1.0.0', ToyKinds, {
          nodes: [
            visibleNode('shop', 'shop', true),
            toyNode('dept', 'shop/hidden'),
          ],
          edges: [],
        }),
      )
      .build();
    const graph = hostGraph().mount(child, UNDER);
    expect(graph.node('chain/branches/shop')?.visible).toBe(true);
    expect(graph.node('chain/branches/shop/hidden')?.visible).toBe(false);
    expect(graph.node('chain')?.visible).toBe(false);
  });

  it('монтирование под несуществующий узел — unknown-mount', () => {
    expect(
      graphErrorCode(() => hostGraph().mount(toyGraph(), 'нет/такого')),
    ).toBe('unknown-mount');
  });

  it('совпадение id с узлом хозяина — duplicate-node', () => {
    const host = new GraphBuilder()
      .add(hostProvider())
      .add(
        contributor('clash', {
          nodes: [toyNode('shop', 'chain/branches/shop')],
          edges: [],
        }),
      )
      .build();
    expect(graphErrorCode(() => host.mount(toyGraph(), UNDER))).toBe(
      'duplicate-node',
    );
  });

  it('host и child после монтирования не изменились', () => {
    const host = hostGraph();
    const child = toyGraph();
    const hostNodes = structuredClone(host.nodes());
    const hostEdges = structuredClone(host.edges());
    const childNodes = structuredClone(child.nodes());
    const childEdges = structuredClone(child.edges());
    host.mount(child, UNDER);
    expect(host.nodes()).toEqual(hostNodes);
    expect(host.edges()).toEqual(hostEdges);
    expect(child.nodes()).toEqual(childNodes);
    expect(child.edges()).toEqual(childEdges);
  });

  it('один child монтируется под разные узлы', () => {
    const host = new GraphBuilder()
      .add(hostProvider())
      .add(
        contributor('more', {
          nodes: [toyNode('dept', 'chain/outlets')],
          edges: [],
        }),
      )
      .build();
    const child = toyGraph();
    const graph = host.mount(child, UNDER).mount(child, 'chain/outlets');
    expect(graph.node('chain/branches/shop/food')).toBeDefined();
    expect(graph.node('chain/outlets/shop/food')).toBeDefined();
  });
});

describe('Graph.mount: сверка видов поставщиков', () => {
  const kindsWith = (nodeKind: string, edgeKind: string) =>
    new GraphBuilder()
      .add(rivalProvider('rival', '1.0.0', rivalKinds(nodeKind, edgeKind)))
      .build();

  it('одноимённый вид узла у поставщиков с разными name — kind-conflict', () => {
    const child = kindsWith('dept', 'rival-edge');
    expect(graphErrorCode(() => hostGraph().mount(child, UNDER))).toBe(
      'kind-conflict',
    );
  });

  it('одноимённый вид ребра у поставщиков с разными name — kind-conflict', () => {
    const child = kindsWith('rival-node', 'uses');
    expect(graphErrorCode(() => hostGraph().mount(child, UNDER))).toBe(
      'kind-conflict',
    );
  });

  it('ошибка конфликта называет вид и обоих поставщиков', () => {
    const error = graphError(() =>
      hostGraph().mount(kindsWith('dept', 'rival-edge'), UNDER),
    );
    expect(error.message).toContain('dept');
    expect(error.message).toContain('toy');
    expect(error.message).toContain('rival');
  });

  it('разные виды у разных name — не конфликт', () => {
    const child = kindsWith('rival-node', 'rival-edge');
    const graph = hostGraph().mount(child, UNDER);
    expect(graph.providers.map((p) => p.name)).toEqual(['rival', 'toy']);
  });

  it('одинаковые (name, version) и равные списки видов — одна запись', () => {
    const graph = hostGraph().mount(toyGraph(), UNDER);
    expect(graph.providers).toEqual([toyInfo()]);
  });

  it('одинаковые (name, version), но другой текст вида узла — kind-conflict', () => {
    const child = new GraphBuilder().add(rivalProvider('toy')).build();
    expect(graphErrorCode(() => hostGraph().mount(child, UNDER))).toBe(
      'kind-conflict',
    );
  });

  it('одинаковые (name, version), но другой состав видов ребра — kind-conflict', () => {
    const child = new GraphBuilder()
      .add(
        new ToyProvider(
          'toy',
          '1.0.0',
          { nodes: ToyKinds.nodes, edges: ToyKinds.edges.slice(0, 1) },
          { nodes: [], edges: [] },
        ),
      )
      .build();
    expect(graphErrorCode(() => hostGraph().mount(child, UNDER))).toBe(
      'kind-conflict',
    );
  });

  it('один name, разные version — две записи, не конфликт, даже при других видах', () => {
    const child = new GraphBuilder().add(rivalProvider('toy', '2.0.0')).build();
    const graph = hostGraph().mount(child, UNDER);
    expect(graph.providers.map((p) => `${p.name}@${p.version}`)).toEqual([
      'toy@1.0.0',
      'toy@2.0.0',
    ]);
    expect(graph.providers[1]?.nodeKinds.map((k) => k.kind)).toEqual(['dept']);
  });
});
