import { describe, expect, it } from 'bun:test';
import {
  contributor,
  toyContribution,
  toyGraph,
  toyKindsOnly,
} from './graph.fixture';
import { GraphBuilder } from './graph-builder';
import { GRAPH_FORMAT, GraphDocument } from './graph-document';

const APP = { name: 'toy-app', version: '3.1.0' };
const document = () => GraphDocument.of(toyGraph(), { app: APP });

describe('GraphDocument', () => {
  it('шапка: format, app, providers, externals', () => {
    const json = document().toJSON();
    expect(json.format).toBe(GRAPH_FORMAT);
    expect(json.app).toEqual(APP);
    expect(json.providers).toEqual([{ name: 'toy', version: '1.0.0' }]);
    expect(json.externals).toEqual(['vendor/catalog/blade']);
  });

  it('порядок ключей документа задан построением', () => {
    expect(Object.keys(document().toJSON())).toEqual([
      'format',
      'app',
      'providers',
      'externals',
      'nodes',
      'edges',
    ]);
  });

  it('узел: состав и порядок ключей, parent у корня отсутствует', () => {
    const { nodes } = document().toJSON();
    const child = nodes.find((n) => n.id === 'shop/food/bread');
    expect(Object.keys(child ?? {})).toEqual([
      'id',
      'kind',
      'label',
      'description',
      'parent',
      'provider',
      'props',
    ]);
    const root = nodes.find((n) => n.id === 'shop');
    expect(Object.keys(root ?? {})).toEqual([
      'id',
      'kind',
      'label',
      'description',
      'provider',
      'props',
    ]);
  });

  it('ребро: состав и порядок ключей, props есть всегда', () => {
    const { edges } = document().toJSON();
    for (const edge of edges) {
      expect(Object.keys(edge)).toEqual([
        'kind',
        'from',
        'to',
        'provider',
        'props',
      ]);
    }
    expect(edges.find((e) => e.kind === 'uses')?.props).toEqual({});
  });

  it('массивы — в каноническом порядке', () => {
    const json = document().toJSON();
    expect(json.nodes.map((n) => n.id)[0]).toBe('depot');
    expect(json.edges.map((e) => e.from)[0]).toBe('shop/food/bread');
  });

  it('два прогона сборки дают одинаковую строку', () => {
    expect(document().serialize()).toBe(
      GraphDocument.of(toyGraph(), { app: APP }).serialize(),
    );
  });

  it('другой порядок поставщиков и вклада — та же строка', () => {
    const { nodes, edges } = toyContribution();
    const split = new GraphBuilder()
      .add(contributor('b', { nodes: nodes.slice(4), edges: edges.slice(2) }))
      .add(
        contributor('a', {
          nodes: nodes.slice(0, 4),
          edges: edges.slice(0, 2),
        }),
      )
      .add(toyKindsOnly('kinds'))
      .build();
    const reversed = new GraphBuilder()
      .add(toyKindsOnly('kinds'))
      .add(
        contributor('a', {
          nodes: nodes.slice(0, 4).reverse(),
          edges: edges.slice(0, 2).reverse(),
        }),
      )
      .add(
        contributor('b', {
          nodes: nodes.slice(4).reverse(),
          edges: edges.slice(2).reverse(),
        }),
      )
      .build();
    expect(GraphDocument.of(split, { app: APP }).serialize()).toBe(
      GraphDocument.of(reversed, { app: APP }).serialize(),
    );
  });

  it('строка заканчивается переводом строки, JSON.parse возвращает toJSON()', () => {
    const doc = document();
    const text = doc.serialize();
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(doc.toJSON());
  });

  it('поднятых рёбер в документе нет', () => {
    const json = document().toJSON();
    expect(json.edges).toHaveLength(toyGraph().edges().length);
    expect(
      json.edges.some((e) => e.from === 'shop/food' && e.to === 'shop/tools'),
    ).toBe(false);
  });
});
