import { describe, expect, it } from 'bun:test';
import {
  contributor,
  graphErrorCode,
  toyEdges,
  toyGraph,
  toyKindsOnly,
  toyNodes,
  toyProvider,
} from './graph.fixture';
import type { LiftedEdge } from './graph.types';
import { GraphBuilder } from './graph-builder';

const key = (e: LiftedEdge) => `${e.from} ${e.kind} ${e.to}`;
const find = (edges: readonly LiftedEdge[], k: string) =>
  edges.find((e) => key(e) === k);

describe('Graph.liftToKind', () => {
  it('два ребра между отделами сливаются в одно с двумя sources', () => {
    const lifted = find(
      toyGraph().liftToKind('dept'),
      'shop/food uses shop/tools',
    );
    expect(lifted?.sources.map((s) => `${s.from}>${s.to}`)).toEqual([
      'shop/food/bread>shop/tools/saw',
      'shop/food/milk>shop/tools/saw',
    ]);
  });

  it('ребро внутри отдела — петля, её нет', () => {
    const lifted = toyGraph().liftToKind('dept');
    expect(lifted.some((e) => e.from === e.to)).toBe(false);
    expect(find(lifted, 'shop/food uses shop/food')).toBeUndefined();
  });

  it('исходная петля отбрасывается', () => {
    const loop = contributor('loop', {
      nodes: [],
      edges: [{ kind: 'uses', from: 'shop/food', to: 'shop/food' }],
    });
    const graph = new GraphBuilder().add(toyProvider()).add(loop).build();
    expect(graph.edges().some((e) => e.from === e.to)).toBe(true);
    expect(graph.liftToKind('dept').some((e) => e.from === e.to)).toBe(false);
    expect(graph.liftToDepth(2).some((e) => e.from === e.to)).toBe(false);
  });

  it('ребро, уже лежащее на уровне, входит с sources из себя', () => {
    const lifted = find(
      toyGraph().liftToKind('dept'),
      'shop/tools uses shop/food',
    );
    expect(lifted?.sources).toHaveLength(1);
    expect(lifted?.sources[0]?.from).toBe('shop/tools');
    expect(lifted?.sources[0]?.to).toBe('shop/food');
  });

  it('kind при подъёме не смешиваются', () => {
    const lifted = toyGraph().liftToKind('dept');
    expect(find(lifted, 'shop/tools ships depot/stock')?.sources).toHaveLength(
      1,
    );
    expect(find(lifted, 'shop/tools uses depot/stock')).toBeUndefined();
  });

  it('внешний конец остаётся как есть, ребро не теряется', () => {
    const lifted = find(
      toyGraph().liftToKind('dept'),
      'shop/tools uses vendor/catalog/blade',
    );
    expect(lifted?.sources).toHaveLength(1);
  });

  it('конец без предка нужного вида остаётся как есть', () => {
    const provider = contributor('extra', {
      nodes: [],
      edges: [{ kind: 'uses', from: 'shop', to: 'depot' }],
    });
    const graph = new GraphBuilder()
      .add(toyKindsOnly('kinds'))
      .add(
        contributor('base', {
          nodes: toyNodes(),
          edges: [],
        }),
      )
      .add(provider)
      .build();
    expect(find(graph.liftToKind('dept'), 'shop uses depot')).toBeDefined();
  });

  it('liftToKind(shop): внутренние связи магазина — петли', () => {
    const lifted = toyGraph().liftToKind('shop');
    expect(lifted.map(key)).toEqual([
      'shop ships depot',
      'shop uses vendor/catalog/blade',
    ]);
  });

  it('порядок: from, kind, to; sources — как в graph.edges()', () => {
    const lifted = toyGraph().liftToKind('dept');
    expect(lifted.map(key)).toEqual([
      'shop/food uses shop/tools',
      'shop/tools ships depot/stock',
      'shop/tools uses shop/food',
      'shop/tools uses vendor/catalog/blade',
    ]);
  });

  it('результат не зависит от порядка добавления рёбер', () => {
    // Поставщик один и тот же: `sources` несут `provider`, меняется только порядок.
    const built = (edges: ReturnType<typeof toyEdges>) =>
      new GraphBuilder()
        .add(toyKindsOnly('kinds'))
        .add(contributor('c', { nodes: toyNodes(), edges }))
        .build();
    expect(built(toyEdges().reverse()).liftToKind('dept')).toEqual(
      built(toyEdges()).liftToKind('dept'),
    );
  });

  it('graph.edges() после подъёма не изменился', () => {
    const graph = toyGraph();
    const before = structuredClone(graph.edges());
    graph.liftToKind('dept');
    graph.liftToDepth(1);
    expect(graph.edges()).toEqual(before);
  });
});

describe('Graph.liftToDepth', () => {
  it('liftToDepth(1): концы усечены до корня, внешний — до vendor', () => {
    const lifted = toyGraph().liftToDepth(1);
    expect(lifted.map(key)).toEqual(['shop ships depot', 'shop uses vendor']);
  });

  it('liftToDepth(2): id короче глубины остаётся как есть', () => {
    const lifted = toyGraph().liftToDepth(2);
    expect(find(lifted, 'shop/tools uses vendor/catalog')).toBeDefined();
    expect(find(lifted, 'shop/food uses shop/tools')?.sources).toHaveLength(2);
  });

  it('глубина не целое ≥ 1 — invalid-depth', () => {
    const graph = toyGraph();
    for (const depth of [0, -1, 1.5, Number.NaN]) {
      expect(graphErrorCode(() => graph.liftToDepth(depth))).toBe(
        'invalid-depth',
      );
    }
  });
});
