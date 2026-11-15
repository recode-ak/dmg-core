import { Graph } from './graph';
import type {
  GraphEdge,
  GraphEdgeInput,
  GraphNodeDraft,
  GraphNodeInput,
  GraphProviderInfo,
} from './graph.types';
import { GraphError } from './graph-error';
import type { GraphProvider } from './graph-provider';
import { KindRegistry } from './kind-registry';

/**
 * Сборка `Graph` из поставщиков (D-92). `build()` двухфазный: сначала виды
 * всех поставщиков, затем вклад — элемент чужого вида не зависит от порядка
 * `add`. Здесь — проверки видов и свойств, структурные — в `Graph`. Виды
 * поставщика уходят в его запись `Graph.providers`.
 */
export class GraphBuilder {
  private readonly providers = new Map<string, GraphProvider>();

  add(provider: GraphProvider): this {
    if (provider.name === '') {
      throw new GraphError('invalid-id', 'Имя поставщика — непустая строка');
    }
    if (this.providers.has(provider.name)) {
      throw new GraphError(
        'duplicate-provider',
        `Поставщик «${provider.name}» уже добавлен`,
      );
    }
    this.providers.set(provider.name, provider);
    return this;
  }

  build(): Graph {
    const providers = [...this.providers.values()];
    const kinds = new KindRegistry();
    const infos: GraphProviderInfo[] = [];
    for (const provider of providers) {
      const declared = provider.kinds();
      kinds.register(provider.name, declared);
      infos.push({
        name: provider.name,
        version: provider.version,
        nodeKinds: declared.nodes,
        edgeKinds: declared.edges,
      });
    }
    const nodes: GraphNodeDraft[] = [];
    const edges: GraphEdge[] = [];
    for (const provider of providers) {
      const contribution = provider.contribute();
      for (const node of contribution.nodes) {
        nodes.push(GraphBuilder.node(kinds, provider.name, node));
      }
      for (const edge of contribution.edges) {
        edges.push(GraphBuilder.edge(kinds, provider.name, edge));
      }
    }
    return new Graph({ providers: infos, nodes, edges });
  }

  private static node(
    kinds: KindRegistry,
    provider: string,
    input: GraphNodeInput,
  ): GraphNodeDraft {
    const { kind, id, label, description, visible = false } = input;
    const props = GraphError.at(`Узел «${id}» поставщика «${provider}»`, () =>
      kinds.nodeProps(kind, input.props),
    );
    return { id, kind, label, description, visible, provider, props };
  }

  private static edge(
    kinds: KindRegistry,
    provider: string,
    input: GraphEdgeInput,
  ): GraphEdge {
    const { kind, from, to } = input;
    const props = GraphError.at(
      `Ребро «${kind}» ${from} → ${to} поставщика «${provider}»`,
      () => kinds.edgeProps(kind, input.props),
    );
    return { kind, from, to, provider, props };
  }
}
