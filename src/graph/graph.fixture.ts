// Игрушечный поставщик для тестов ядра графа (D-92): магазин с отделами и
// товарами, склад, хозяин для монтирования. Ядро о предметной области не знает.
import * as v from 'valibot';
import type { Graph } from './graph';
import type { GraphEdgeInput, GraphNodeInput } from './graph.types';
import { GraphBuilder } from './graph-builder';
import { GraphError } from './graph-error';
import type { GraphErrorCode } from './graph-error.types';
import type { GraphContribution, GraphProvider } from './graph-provider';
import type { GraphKindInfo, GraphKinds } from './kind-registry.types';

export class ToyProvider implements GraphProvider {
  constructor(
    readonly name: string,
    readonly version: string,
    private readonly kindSpecs: GraphKinds,
    private readonly contribution: GraphContribution,
  ) {}

  kinds(): GraphKinds {
    return this.kindSpecs;
  }

  contribute(): GraphContribution {
    return this.contribution;
  }
}

export const ToyKinds: GraphKinds = {
  nodes: [
    { kind: 'shop', label: 'Магазин', description: 'Корень набора.' },
    { kind: 'dept', label: 'Отдел', description: 'Группа товаров.' },
    {
      kind: 'item',
      label: 'Товар',
      description: 'Позиция с ценой.',
      props: v.strictObject({ price: v.number() }),
    },
  ],
  edges: [
    { kind: 'uses', label: 'Использует', description: 'Связь без свойств.' },
    {
      kind: 'ships',
      label: 'Поставляет',
      description: 'Связь со сроком.',
      props: v.strictObject({ days: v.number() }),
    },
  ],
};

/** Описания видов `ToyKinds` в записи поставщика: по `kind`, без схем. */
export const ToyNodeKindInfos: readonly GraphKindInfo[] = [
  { kind: 'dept', label: 'Отдел', description: 'Группа товаров.' },
  { kind: 'item', label: 'Товар', description: 'Позиция с ценой.' },
  { kind: 'shop', label: 'Магазин', description: 'Корень набора.' },
];

export const ToyEdgeKindInfos: readonly GraphKindInfo[] = [
  { kind: 'ships', label: 'Поставляет', description: 'Связь со сроком.' },
  { kind: 'uses', label: 'Использует', description: 'Связь без свойств.' },
];

/** Запись `toy@1.0.0` в `graph.providers` и в шапке документа. */
export const toyInfo = (version = '1.0.0') => ({
  name: 'toy',
  version,
  nodeKinds: ToyNodeKindInfos,
  edgeKinds: ToyEdgeKindInfos,
});

export const NoKinds: GraphKinds = { nodes: [], edges: [] };
export const NoContribution: GraphContribution = { nodes: [], edges: [] };

export function toyNode(
  kind: string,
  id: string,
  props?: Record<string, unknown>,
): GraphNodeInput {
  return {
    kind,
    id,
    label: `Узел ${id}`,
    description: `Описание ${id}.`,
    ...(props ? { props } : {}),
  };
}

/** Узел с явным `visible` (по умолчанию в `toyNode` поля нет). */
export function visibleNode(
  kind: string,
  id: string,
  visible: boolean,
  props?: Record<string, unknown>,
): GraphNodeInput {
  return { ...toyNode(kind, id, props), visible };
}

export function toyEdge(
  kind: string,
  from: string,
  to: string,
  props?: Record<string, unknown>,
): GraphEdgeInput {
  return { kind, from, to, ...(props ? { props } : {}) };
}

export const toyNodes = (): GraphNodeInput[] => [
  toyNode('shop', 'shop'),
  toyNode('dept', 'shop/food'),
  toyNode('item', 'shop/food/bread', { price: 3 }),
  toyNode('item', 'shop/food/milk', { price: 5 }),
  toyNode('dept', 'shop/tools'),
  toyNode('item', 'shop/tools/saw', { price: 40 }),
  toyNode('shop', 'depot'),
  toyNode('dept', 'depot/stock'),
  toyNode('item', 'depot/stock/pallet', { price: 100 }),
];

export const toyEdges = (): GraphEdgeInput[] => [
  toyEdge('uses', 'shop/food/bread', 'shop/food/milk'),
  toyEdge('uses', 'shop/food/bread', 'shop/tools/saw'),
  toyEdge('uses', 'shop/food/milk', 'shop/tools/saw'),
  toyEdge('uses', 'shop/tools', 'shop/food'),
  toyEdge('uses', 'shop/tools/saw', 'vendor/catalog/blade'),
  toyEdge('ships', 'shop/tools/saw', 'depot/stock/pallet', { days: 2 }),
];

export const toyContribution = (): GraphContribution => ({
  nodes: toyNodes(),
  edges: toyEdges(),
});

/** Поставщик `toy@1.0.0`: виды и весь вклад. */
export const toyProvider = (): ToyProvider =>
  new ToyProvider('toy', '1.0.0', ToyKinds, toyContribution());

/** Поставщик только с видами `toy`, без вклада. */
export const toyKindsOnly = (name = 'toy'): ToyProvider =>
  new ToyProvider(name, '1.0.0', ToyKinds, NoContribution);

/**
 * Соперник `toy` по видам: свои виды `dept` (узел) и `uses` (ребро) с другими
 * текстами. Под другим именем — конфликт с `toy`; под тем же именем и версией
 * — тоже, пока списки видов различаются.
 */
export const rivalKinds = (
  nodeKind = 'dept',
  edgeKind = 'uses',
): GraphKinds => ({
  nodes: [
    { kind: nodeKind, label: 'Чужой отдел', description: 'Другой смысл.' },
  ],
  edges: [
    { kind: edgeKind, label: 'Чужая связь', description: 'Другой смысл.' },
  ],
});

export const rivalProvider = (
  name = 'rival',
  version = '1.0.0',
  kinds: GraphKinds = rivalKinds(),
): ToyProvider => new ToyProvider(name, version, kinds, NoContribution);

/** Поставщик без видов: вклад чужих видов. */
export const contributor = (
  name: string,
  contribution: GraphContribution,
  version = '1.0.0',
): ToyProvider => new ToyProvider(name, version, NoKinds, contribution);

export const toyGraph = (): Graph =>
  new GraphBuilder().add(toyProvider()).build();

/** Хозяин для монтирования: `chain`, `chain/branches` и ссылка на будущий узел. */
export const hostProvider = (): ToyProvider =>
  new ToyProvider('toy', '1.0.0', ToyKinds, {
    nodes: [toyNode('shop', 'chain'), toyNode('dept', 'chain/branches')],
    edges: [toyEdge('uses', 'chain/branches', 'chain/branches/shop/tools/saw')],
  });

export const hostGraph = (): Graph =>
  new GraphBuilder().add(hostProvider()).build();

/** Выполняет `fn` и возвращает брошенную `GraphError`; иное — падение теста. */
export function graphError(fn: () => unknown): GraphError {
  try {
    fn();
  } catch (error) {
    if (error instanceof GraphError) return error;
    throw error;
  }
  throw new Error('ожидалась GraphError, исключения не было');
}

export function graphErrorCode(fn: () => unknown): GraphErrorCode {
  return graphError(fn).code;
}
