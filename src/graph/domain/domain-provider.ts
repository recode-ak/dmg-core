import manifest from '../../../package.json' with { type: 'json' };
import type { AnyAggregateDef } from '../../domain/aggregate/aggregate-def';
import type { AnyAppDef } from '../../domain/contracts/app-def';
import type { AnyModuleDef } from '../../domain/contracts/module-def';
import type { AnyUseCaseDef } from '../../domain/contracts/use-case-def';
import type { AnyDomainRule } from '../../domain/rules/domain-rule-def';
import type { Def } from '../../kernel/def/def';
import { type AnyOperationDef, DefIndex } from '../def-index';
import type {
  GraphEdgeInput,
  GraphNodeInput,
  GraphProps,
} from '../graph.types';
import type { GraphContribution, GraphProvider } from '../graph-provider';
import type { GraphKinds } from '../kind-registry.types';
import { DomainIds } from './domain-ids';
import { DOMAIN_KINDS, DOMAIN_PROVIDER } from './domain-kinds';

/**
 * Поставщик домена (D-95): узлы и рёбра по `AppDef` и Def его модулей, на
 * общих основаниях с любым поставщиком. Свойства узла — выбор ключей
 * `normalize()` Def; ребро ставит тот, кто объявил ссылку. Версия — версия
 * пакета; `ids` отдаёт те же `id`, что в узлах.
 */
export class DomainProvider implements GraphProvider {
  readonly name = DOMAIN_PROVIDER;
  readonly version: string = manifest.version;
  readonly ids: DomainIds;
  private readonly index: DefIndex;

  constructor(private readonly app: AnyAppDef) {
    this.ids = new DomainIds(app);
    this.index = DefIndex.from(app.modules);
  }

  kinds(): GraphKinds {
    return DOMAIN_KINDS;
  }

  contribute(): GraphContribution {
    const modules = this.index.modules;
    const rules = this.domainRules();
    return {
      nodes: [
        this.appNode(),
        ...modules.flatMap((m) => this.moduleNodes(m)),
        ...rules.map((r) => DomainProvider.node(r, this.ids.rule(r))),
      ],
      edges: DomainProvider.unique([
        ...modules.flatMap((m) => this.moduleEdges(m)),
        ...rules.map((r) =>
          DomainProvider.edge(
            'failsWith',
            this.ids.rule(r),
            this.ids.error(r.error),
          ),
        ),
      ]),
    };
  }

  private appNode(): GraphNodeInput {
    return DomainProvider.node(
      this.app,
      this.ids.app(),
      DomainProvider.pick(this.app.normalize(), ['scale']),
    );
  }

  private moduleNodes(m: AnyModuleDef): GraphNodeInput[] {
    const { node, pick } = DomainProvider;
    return [
      node(m, this.ids.module(m), pick(m.normalize(), ['external'])),
      ...m.aggregates.flatMap((a) => this.aggregateNodes(a)),
      ...m.useCases.map((uc) =>
        node(
          uc,
          this.ids.operation(uc),
          pick(uc.normalize(), [
            'exposed',
            'type',
            'callers',
            'personal',
            'policy',
            'input',
            'output',
          ]),
        ),
      ),
      ...m.reactions.map((er) => node(er, this.ids.operation(er))),
      ...m.jobs.map((job) =>
        node(job, this.ids.operation(job), pick(job.normalize(), ['schedule'])),
      ),
    ];
  }

  private aggregateNodes(a: AnyAggregateDef): GraphNodeInput[] {
    const { node, pick } = DomainProvider;
    return [
      node(
        a,
        this.ids.aggregate(a),
        pick(a.normalize(), ['state', 'statuses', 'transitions']),
      ),
      ...Object.values(a.events).map((e) =>
        node(
          e,
          this.ids.event(e),
          pick(e.normalize(), ['name', 'exposed', 'payload']),
        ),
      ),
      ...Object.values(a.errors).map((e) =>
        node(e, this.ids.error(e), pick(e.normalize(), ['kind', 'payload'])),
      ),
    ];
  }

  // Правила, на которые ссылается хотя бы один UC, по одному на Def; правило
  // с ошибкой вне модулей — не узел (внешний `id`).
  private domainRules(): AnyDomainRule[] {
    const referenced = this.index.modules.flatMap((m) =>
      m.useCases.flatMap((uc): readonly AnyDomainRule[] => uc.rules),
    );
    return [...new Set(referenced)].filter(
      (r) => this.index.aggregateOf(r.error) !== undefined,
    );
  }

  private moduleEdges(m: AnyModuleDef): GraphEdgeInput[] {
    const from = this.ids.module(m);
    return [
      ...m.dependsOn.map((dep) =>
        DomainProvider.edge('dependsOn', from, this.ids.module(dep)),
      ),
      ...m.operations().flatMap((op) => this.operationEdges(op)),
      ...m.useCases.flatMap((uc) => this.useCaseEdges(uc)),
    ];
  }

  private operationEdges(op: AnyOperationDef): GraphEdgeInput[] {
    const { edge } = DomainProvider;
    const from = this.ids.operation(op);
    return [
      ...op
        .aggregates()
        .map((a) => edge('touches', from, this.ids.aggregate(a))),
      ...op.calls.map((uc) => edge('calls', from, this.ids.operation(uc))),
      ...op.emits.map((e) => edge('emits', from, this.ids.event(e))),
      ...op
        .subscribedEvents()
        .map((e) => edge('subscribes', from, this.ids.event(e))),
    ];
  }

  private useCaseEdges(uc: AnyUseCaseDef): GraphEdgeInput[] {
    const { edge } = DomainProvider;
    const from = this.ids.operation(uc);
    return [
      ...uc.errors.map((e) => edge('failsWith', from, this.ids.error(e))),
      ...uc.rules.map((r) => edge('checks', from, this.ids.rule(r))),
    ];
  }

  private static node(
    def: Pick<Def, 'dmg' | 'label' | 'description' | 'visible'>,
    id: string,
    props: GraphProps = {},
  ): GraphNodeInput {
    const { dmg: kind, label, description, visible } = def;
    return { kind, id, label, description, visible, props };
  }

  private static edge(kind: string, from: string, to: string): GraphEdgeInput {
    return { kind, from, to };
  }

  // Ключ без значения не пишется: свойства узла — JSON без `undefined`.
  private static pick(
    form: Readonly<Record<string, unknown>>,
    keys: readonly string[],
  ): GraphProps {
    return Object.fromEntries(
      keys.flatMap((key) =>
        form[key] === undefined ? [] : [[key, form[key]]],
      ),
    );
  }

  // Повтор ссылки в Def (`rules: [r, r]`) сборку не роняет: о нём сообщает
  // `arch:check`.
  private static unique(edges: readonly GraphEdgeInput[]): GraphEdgeInput[] {
    const known = new Map<string, GraphEdgeInput>();
    for (const edge of edges) {
      known.set(`${edge.from} ${edge.to} ${edge.kind}`, edge);
    }
    return [...known.values()];
  }
}
