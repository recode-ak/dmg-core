import type { GraphEdge, GraphNode, GraphProviderInfo } from './graph.types';

export type GraphDocumentJson = {
  readonly format: number;
  readonly app: GraphProviderInfo;
  readonly providers: readonly GraphProviderInfo[];
  readonly externals: readonly string[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};
