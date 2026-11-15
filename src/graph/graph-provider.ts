// Порт поставщика узлов и рёбер графа (D-92); как `EventBus` — тип без класса.
import type { GraphEdgeInput, GraphNodeInput } from './graph.types';
import type { GraphKinds } from './kind-registry.types';

export type GraphContribution = {
  readonly nodes: readonly GraphNodeInput[];
  readonly edges: readonly GraphEdgeInput[];
};

export type GraphProvider = {
  readonly name: string;
  readonly version: string;
  kinds(): GraphKinds;
  contribute(): GraphContribution;
};
