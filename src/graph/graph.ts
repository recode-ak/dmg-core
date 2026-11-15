import type {
  GraphEdge,
  GraphNode,
  GraphNodeDraft,
  GraphParts,
  GraphProviderInfo,
  LiftedEdge,
} from './graph.types';
import { GraphError } from './graph-error';
import { GraphId } from './graph-id';
import type { GraphKindInfo } from './kind-registry.types';

type Link = { kind: string; from: string; to: string };

/**
 * Неизменяемый граф (D-92): дерево узлов по `id`, рёбра между ними, внешние
 * ссылки и поставщики с их видами; чтения — в каноническом порядке. Создают
 * его `GraphBuilder.build()` и `mount()`: конструктор — их общее место
 * структурных проверок и сверки видов, в публичный контракт не входит.
 */
export class Graph {
  readonly providers: readonly GraphProviderInfo[];
  private readonly nodeIndex: ReadonlyMap<string, GraphNode>;
  private readonly nodeList: readonly GraphNode[];
  private readonly edgeList: readonly GraphEdge[];
  private readonly externalIds: readonly string[];

  constructor(parts: GraphParts) {
    this.providers = Graph.providersOf(parts.providers);
    this.nodeIndex = Graph.nodesOf(parts.nodes);
    this.nodeList = [...this.nodeIndex.values()].sort((a, b) =>
      GraphId.compare(a.id, b.id),
    );
    this.edgeList = Graph.edgesOf(parts.edges, this.nodeIndex);
    const external = this.edgeList
      .map((edge) => edge.to)
      .filter((to) => !this.nodeIndex.has(to));
    this.externalIds = [...new Set(external)].sort(GraphId.compare);
  }

  // Запись на пару (name, version); описания вида — три поля, без схемы
  // свойств. Версии одного поставщика между собой не сверяются: вид
  // принадлежит имени поставщика.
  private static providersOf(
    providers: readonly GraphProviderInfo[],
  ): readonly GraphProviderInfo[] {
    const sorted = providers
      .map(({ name, version, nodeKinds, edgeKinds }) => ({
        name,
        version,
        nodeKinds: Graph.kindsOf(nodeKinds),
        edgeKinds: Graph.kindsOf(edgeKinds),
      }))
      .sort(
        (a, b) =>
          Graph.compareText(a.name, b.name) ||
          Graph.compareText(a.version, b.version),
      );
    const merged: GraphProviderInfo[] = [];
    for (const provider of sorted) {
      const previous = merged.at(-1);
      if (
        previous?.name !== provider.name ||
        previous.version !== provider.version
      ) {
        merged.push(provider);
        continue;
      }
      const who = `поставщика «${provider.name}» версии «${provider.version}»`;
      Graph.sameKinds('узла', who, previous.nodeKinds, provider.nodeKinds);
      Graph.sameKinds('ребра', who, previous.edgeKinds, provider.edgeKinds);
    }
    Graph.kindOwners('узла', merged, (provider) => provider.nodeKinds);
    Graph.kindOwners('ребра', merged, (provider) => provider.edgeKinds);
    return merged;
  }

  private static kindsOf(
    kinds: readonly GraphKindInfo[],
  ): readonly GraphKindInfo[] {
    return kinds
      .map(({ kind, label, description }) => ({ kind, label, description }))
      .sort((a, b) => Graph.compareText(a.kind, b.kind));
  }

  // Списки отсортированы по `kind`: на первом расхождении меньший вид либо
  // отсутствует во втором списке, либо описан в нём иначе.
  private static sameKinds(
    element: string,
    who: string,
    a: readonly GraphKindInfo[],
    b: readonly GraphKindInfo[],
  ): void {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const [x, y] = [a[i], b[i]];
      if (
        x?.kind === y?.kind &&
        x?.label === y?.label &&
        x?.description === y?.description
      ) {
        continue;
      }
      const kind = [x?.kind, y?.kind]
        .filter((name) => name !== undefined)
        .sort(Graph.compareText)[0];
      throw new GraphError(
        'kind-conflict',
        `Вид ${element} «${kind}» ${who} расходится в соединяемых графах: отсутствует в одном из них или описан иначе`,
      );
    }
  }

  private static kindOwners(
    element: string,
    providers: readonly GraphProviderInfo[],
    kindsIn: (provider: GraphProviderInfo) => readonly GraphKindInfo[],
  ): void {
    const owners = new Map<string, string>();
    for (const provider of providers) {
      for (const { kind } of kindsIn(provider)) {
        const owner = owners.get(kind) ?? provider.name;
        if (owner !== provider.name) {
          throw new GraphError(
            'kind-conflict',
            `Вид ${element} «${kind}» объявлен поставщиками «${owner}» и «${provider.name}»: у вида один поставщик`,
          );
        }
        owners.set(kind, owner);
      }
    }
  }

  private static nodesOf(
    drafts: readonly GraphNodeDraft[],
  ): ReadonlyMap<string, GraphNode> {
    const nodes = new Map<string, GraphNode>();
    for (const draft of drafts) {
      const { id, kind, label, description, visible, provider, props } = draft;
      const place = `Узел «${id}» вида «${kind}» поставщика «${provider}»`;
      const parent = GraphError.at(place, () => GraphId.parse(id).parent());
      const known = nodes.get(id);
      if (known) {
        throw new GraphError(
          'duplicate-node',
          `${place}: id уже занят узлом поставщика «${known.provider}»`,
        );
      }
      nodes.set(id, {
        id,
        kind,
        label,
        description,
        visible,
        ...(parent ? { parent: parent.toString() } : {}),
        provider,
        props,
      });
    }
    for (const node of nodes.values()) {
      if (node.parent !== undefined && !nodes.has(node.parent)) {
        throw new GraphError(
          'unknown-parent',
          `Узел «${node.id}» вида «${node.kind}» поставщика «${node.provider}»: родитель «${node.parent}» не узел графа`,
        );
      }
    }
    return nodes;
  }

  private static edgesOf(
    drafts: readonly GraphEdge[],
    nodes: ReadonlyMap<string, GraphNode>,
  ): readonly GraphEdge[] {
    const edges = new Map<string, GraphEdge>();
    for (const { kind, from, to, provider, props } of drafts) {
      const place = `Ребро «${kind}» ${from} → ${to} поставщика «${provider}»`;
      GraphError.at(place, () => {
        GraphId.parse(from);
        GraphId.parse(to);
      });
      if (!nodes.has(from)) {
        throw new GraphError(
          'unknown-source',
          `${place}: начало «${from}» не узел графа`,
        );
      }
      // Концы валидны и пробелов не содержат; вид — последним: ключ однозначен.
      const key = `${from} ${to} ${kind}`;
      const known = edges.get(key);
      if (known) {
        throw new GraphError(
          'duplicate-edge',
          `${place}: такое ребро уже поставил «${known.provider}»`,
        );
      }
      edges.set(key, { kind, from, to, provider, props });
    }
    return [...edges.values()].sort(Graph.compareLinks);
  }

  private static compareLinks(a: Link, b: Link): number {
    return (
      GraphId.compare(a.from, b.from) ||
      Graph.compareText(a.kind, b.kind) ||
      GraphId.compare(a.to, b.to)
    );
  }

  // По кодовым единицам, не `localeCompare`: порядок не зависит от локали.
  private static compareText(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  nodes(): readonly GraphNode[] {
    return this.nodeList;
  }

  edges(): readonly GraphEdge[] {
    return this.edgeList;
  }

  node(id: string): GraphNode | undefined {
    return this.nodeIndex.get(id);
  }

  roots(): readonly GraphNode[] {
    return this.nodeList.filter((node) => node.parent === undefined);
  }

  children(id: string): readonly GraphNode[] {
    return this.nodeList.filter((node) => node.parent === id);
  }

  /** От родителя к корню; у `id` вне графа предков нет. */
  ancestors(id: string): readonly GraphNode[] {
    const found: GraphNode[] = [];
    let current = this.nodeIndex.get(id);
    while (current?.parent !== undefined) {
      current = this.nodeIndex.get(current.parent);
      if (current) found.push(current);
    }
    return found;
  }

  /** Рёбра из узла `id`, при `kind` — только этого вида; неизвестный `id` — `[]`. */
  outgoing(id: string, kind?: string): readonly GraphEdge[] {
    return this.edgeList.filter(
      (edge) => edge.from === id && (kind === undefined || edge.kind === kind),
    );
  }

  /** Рёбра в `id`, при `kind` — только этого вида; `id` может быть внешней ссылкой. */
  incoming(id: string, kind?: string): readonly GraphEdge[] {
    return this.edgeList.filter(
      (edge) => edge.to === id && (kind === undefined || edge.kind === kind),
    );
  }

  /** Концы рёбер, которые не узлы графа; внешнюю ссылку от опечатки ядро не отличает. */
  externals(): readonly string[] {
    return this.externalIds;
  }

  /**
   * Рёбра, поднятые к ближайшему узлу вида `kind` на пути от конца к корню,
   * включая сам конец. Внешний конец и конец без такого предка остаются как есть.
   */
  liftToKind(kind: string): readonly LiftedEdge[] {
    return this.lift((id) => {
      const node = this.nodeIndex.get(id);
      if (!node) return id;
      const path = [node, ...this.ancestors(id)];
      return path.find((step) => step.kind === kind)?.id ?? id;
    });
  }

  /**
   * Рёбра, поднятые к приставке `id` из `depth` сегментов. Работает по пути,
   * поэтому усекает и внешние концы.
   */
  liftToDepth(depth: number): readonly LiftedEdge[] {
    if (!GraphId.isDepth(depth)) {
      throw new GraphError(
        'invalid-depth',
        `Глубина подъёма — целое ≥ 1, получено ${depth}`,
      );
    }
    return this.lift((id) => GraphId.parse(id).prefix(depth).toString());
  }

  /**
   * Новый граф: узлы `child` получают приставку `under/`, его рёбра — тоже,
   * кроме внешних концов. Внешняя ссылка этого графа, совпавшая с новым узлом,
   * перестаёт быть внешней. Виды поставщиков сверяются: одноимённый вид у
   * разных поставщиков и разные описания одной версии — `kind-conflict`.
   */
  mount(child: Graph, under: string): Graph {
    if (!this.nodeIndex.has(under)) {
      throw new GraphError(
        'unknown-mount',
        `Узла монтирования «${under}» нет в графе`,
      );
    }
    const prefix = GraphId.parse(under);
    const moved = (id: string) => GraphId.parse(id).under(prefix).toString();
    return new Graph({
      providers: [...this.providers, ...child.providers],
      nodes: [
        ...this.nodeList,
        ...child.nodeList.map((node) => ({ ...node, id: moved(node.id) })),
      ],
      edges: [
        ...this.edgeList,
        ...child.edgeList.map((edge) => ({
          ...edge,
          from: moved(edge.from),
          to: child.nodeIndex.has(edge.to) ? moved(edge.to) : edge.to,
        })),
      ],
    });
  }

  // Одна запись на тройку (kind, from', to'); петля отбрасывается. Рёбра
  // обходятся в каноническом порядке — в нём же лежат `sources`.
  private lift(representative: (id: string) => string): readonly LiftedEdge[] {
    const lifted = new Map<string, Link & { sources: GraphEdge[] }>();
    for (const edge of this.edgeList) {
      const from = representative(edge.from);
      const to = representative(edge.to);
      if (from === to) continue;
      const key = `${from} ${to} ${edge.kind}`;
      const known = lifted.get(key);
      if (known) known.sources.push(edge);
      else lifted.set(key, { kind: edge.kind, from, to, sources: [edge] });
    }
    return [...lifted.values()].sort(Graph.compareLinks);
  }
}
