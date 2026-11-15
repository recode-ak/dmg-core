// Типы ядра графа (D-92). `id` — строка без брендов. Поля `readonly`: граф
// неизменяем, элементы из его чтений не правятся.

export type GraphProps = Readonly<Record<string, unknown>>;

export type GraphNodeInput = {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly props?: GraphProps;
};

export type GraphNode = {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly parent?: string;
  readonly provider: string;
  readonly props: GraphProps;
};

export type GraphEdgeInput = {
  readonly kind: string;
  readonly from: string;
  readonly to: string;
  readonly props?: GraphProps;
};

export type GraphEdge = {
  readonly kind: string;
  readonly from: string;
  readonly to: string;
  readonly provider: string;
  readonly props: GraphProps;
};

export type GraphProviderInfo = {
  readonly name: string;
  readonly version: string;
};

export type LiftedEdge = {
  readonly kind: string;
  readonly from: string;
  readonly to: string;
  readonly sources: readonly GraphEdge[];
};

/** Узел до структурных проверок: `parent` выводит `Graph` из `id`. */
export type GraphNodeDraft = Omit<GraphNode, 'parent'>;

/** Вход конструктора `Graph` — от `GraphBuilder` и `Graph.mount`; порядок любой. */
export type GraphParts = {
  readonly providers: readonly GraphProviderInfo[];
  readonly nodes: readonly GraphNodeDraft[];
  readonly edges: readonly GraphEdge[];
};
