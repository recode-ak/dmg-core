// dmg-core/graph — ядро графа (D-92): узлы и рёбра от поставщиков, подъём,
// монтирование, документ формата 1; о слоях и домене ядро не знает. Рядом —
// поставщик домена и граф приложения (D-95, `./domain`), нормализация Def и
// индекс Def для проверок архитектуры.

export { type AnyOperationDef, DefIndex } from './def-index';
export { AppGraph } from './domain/app-graph';
export { DomainIds } from './domain/domain-ids';
export { DOMAIN_KINDS, DOMAIN_PROVIDER } from './domain/domain-kinds';
export { DomainProvider } from './domain/domain-provider';
export type { GraphApp } from './domain/graph-app.types';
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
export type { GraphRule } from './graph-rule.types';
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
export type {
  LayerAccess,
  LayerAxis,
  LayerEntry,
  LayerOthers,
  SourceLayer,
} from './source-layer.types';
