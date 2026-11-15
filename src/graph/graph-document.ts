import type { Graph } from './graph';
import type {
  GraphAppInfo,
  GraphEdge,
  GraphNode,
  GraphProviderInfo,
} from './graph.types';
import type { GraphDocumentJson } from './graph-document.types';
import type { GraphKindInfo } from './kind-registry.types';

export const GRAPH_FORMAT = 1;

/**
 * Документ графа формата 1 (D-92): шапка с видами поставщиков, узлы и рёбра в
 * каноническом порядке. Порядок ключей задан построением объектов — одинаковый
 * граф даёт одинаковую строку; ключи внутри `props` не пересортировываются.
 * `app` — данные вызывающего, с корнями графа не сверяется.
 */
export class GraphDocument {
  private constructor(
    private readonly graph: Graph,
    private readonly app: GraphAppInfo,
  ) {}

  static of(graph: Graph, header: { app: GraphAppInfo }): GraphDocument {
    const { name, version } = header.app;
    return new GraphDocument(graph, { name, version });
  }

  private static provider(info: GraphProviderInfo): GraphProviderInfo {
    const { name, version, nodeKinds, edgeKinds } = info;
    return {
      name,
      version,
      nodeKinds: nodeKinds.map(GraphDocument.kind),
      edgeKinds: edgeKinds.map(GraphDocument.kind),
    };
  }

  private static kind(info: GraphKindInfo): GraphKindInfo {
    const { kind, label, description } = info;
    return { kind, label, description };
  }

  private static node(node: GraphNode): GraphNode {
    const { id, kind, label, description, visible, parent, provider, props } =
      node;
    return {
      id,
      kind,
      label,
      description,
      visible,
      ...(parent === undefined ? {} : { parent }),
      provider,
      props,
    };
  }

  private static edge(edge: GraphEdge): GraphEdge {
    const { kind, from, to, provider, props } = edge;
    return { kind, from, to, provider, props };
  }

  toJSON(): GraphDocumentJson {
    return {
      format: GRAPH_FORMAT,
      app: { name: this.app.name, version: this.app.version },
      providers: this.graph.providers.map(GraphDocument.provider),
      externals: [...this.graph.externals()],
      nodes: this.graph.nodes().map(GraphDocument.node),
      edges: this.graph.edges().map(GraphDocument.edge),
    };
  }

  serialize(): string {
    return `${JSON.stringify(this.toJSON(), null, 2)}\n`;
  }
}
