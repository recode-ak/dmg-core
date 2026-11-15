// dmg-core/graph — ядро графа (D-92): узлы и рёбра от поставщиков, подъём,
// монтирование, документ формата 1; о слоях и домене ядро не знает. Рядом —
// нормализация Def и граф домена L0/L1/L2 (документация, MCP, проверки
// архитектуры).

export { type AnyOperationDef, DefIndex } from './def-index';
export {
  type AggregateNode,
  buildGraph,
  type DomainGraph,
  type DomainRuleNode,
  type ErrorNode,
  type EventNode,
  type JobNode,
  type ModuleLink,
  type ModuleNode,
  type ReactionNode,
  type UseCaseNode,
} from './domain-graph';
export { Graph } from './graph';
export type {
  GraphAppInfo,
  GraphEdge,
  GraphEdgeInput,
  GraphNode,
  GraphNodeInput,
  GraphProps,
  GraphProviderInfo,
  LiftedEdge,
} from './graph.types';
export { GraphBuilder } from './graph-builder';
export { GRAPH_FORMAT, GraphDocument } from './graph-document';
export type { GraphDocumentJson } from './graph-document.types';
export { GraphError } from './graph-error';
export type { GraphErrorCode } from './graph-error.types';
export { GraphId } from './graph-id';
export type { GraphContribution, GraphProvider } from './graph-provider';
export { KindRegistry } from './kind-registry';
export type {
  GraphKindInfo,
  GraphKindSpec,
  GraphKinds,
  RegisteredKind,
} from './kind-registry.types';
export {
  type AnyDef,
  type NormalizedAggregate,
  type NormalizedApp,
  type NormalizedDef,
  type NormalizedDomainRule,
  type NormalizedError,
  type NormalizedEvent,
  type NormalizedEventReaction,
  type NormalizedJob,
  type NormalizedModule,
  type NormalizedPolicy,
  type NormalizedRule,
  type NormalizedRules,
  type NormalizedUseCase,
  normalize,
} from './normalize';
