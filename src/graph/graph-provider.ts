// Порт поставщика узлов и рёбер графа (D-92); как `EventBus` — тип без класса.
import type { GraphEdgeInput, GraphNodeInput } from './graph.types';
import type { GraphRule } from './graph-rule.types';
import type { GraphKinds } from './kind-registry.types';
import type { SourceLayer } from './source-layer.types';

export type GraphContribution = {
  readonly nodes: readonly GraphNodeInput[];
  readonly edges: readonly GraphEdgeInput[];
};

export type GraphProvider = {
  readonly name: string;
  readonly version: string;
  kinds(): GraphKinds;
  contribute(): GraphContribution;
  rules?(): readonly GraphRule[];
  /** Слои исходников для `arch:check` (D-107); ядро графа их не читает. */
  layers?(): readonly SourceLayer[];
};
