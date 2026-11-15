import type {
  GraphAppInfo,
  GraphEdge,
  GraphNode,
  GraphProviderInfo,
} from './graph.types';

export type GraphDocumentJson = {
  readonly format: number;
  readonly app: GraphAppInfo;
  readonly providers: readonly GraphProviderInfo[];
  readonly externals: readonly string[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};
