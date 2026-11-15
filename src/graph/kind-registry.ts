import * as v from 'valibot';
import type { GraphProps } from './graph.types';
import { GraphError } from './graph-error';
import { GraphId } from './graph-id';
import type {
  GraphKindSpec,
  GraphKinds,
  RegisteredKind,
} from './kind-registry.types';

/**
 * Виды узлов и рёбер графа и их поставщики (D-92): вид регистрируется один
 * раз, пространства видов узлов и рёбер раздельные. Свойства элемента — выход
 * схемы вида; лишние ключи ловит схема поставщика, реестр их сам не ищет.
 */
export class KindRegistry {
  private readonly nodeKinds = new Map<string, RegisteredKind>();
  private readonly edgeKinds = new Map<string, RegisteredKind>();

  register(provider: string, kinds: GraphKinds): void {
    for (const spec of kinds.nodes) {
      this.add(this.nodeKinds, 'узла', provider, spec);
    }
    for (const spec of kinds.edges) {
      this.add(this.edgeKinds, 'ребра', provider, spec);
    }
  }

  node(kind: string): RegisteredKind | undefined {
    return this.nodeKinds.get(kind);
  }

  edge(kind: string): RegisteredKind | undefined {
    return this.edgeKinds.get(kind);
  }

  nodeProps(kind: string, props: GraphProps | undefined): GraphProps {
    return this.props(this.nodeKinds, 'узла', kind, props);
  }

  edgeProps(kind: string, props: GraphProps | undefined): GraphProps {
    return this.props(this.edgeKinds, 'ребра', kind, props);
  }

  private add(
    space: Map<string, RegisteredKind>,
    element: string,
    provider: string,
    spec: GraphKindSpec,
  ): void {
    if (!GraphId.isSegment(spec.kind)) {
      throw new GraphError(
        'invalid-id',
        `Имя вида ${element} «${spec.kind}» поставщика «${provider}» не по правилу сегмента id`,
      );
    }
    const registered = space.get(spec.kind);
    if (registered) {
      throw new GraphError(
        'duplicate-kind',
        `Вид ${element} «${spec.kind}» уже зарегистрирован поставщиком «${registered.provider}»; повтор — от «${provider}»`,
      );
    }
    space.set(spec.kind, { ...spec, provider });
  }

  // Свойства не заданы — схема получает пустой объект: вид с одними
  // необязательными свойствами не требует `props: {}` у каждого элемента.
  private props(
    space: ReadonlyMap<string, RegisteredKind>,
    element: string,
    kind: string,
    props: GraphProps | undefined,
  ): GraphProps {
    const registered = space.get(kind);
    if (!registered) {
      throw new GraphError(
        'unknown-kind',
        `Вид ${element} «${kind}» не зарегистрирован`,
      );
    }
    const where = `вид ${element} «${kind}» поставщика «${registered.provider}»`;
    if (!registered.props) {
      const extra = Object.keys(props ?? {});
      if (extra.length === 0) return {};
      throw new GraphError(
        'invalid-props',
        `Свойства ${extra.join(', ')} не приняты: ${where} объявлен без схемы свойств`,
      );
    }
    const parsed = v.safeParse(registered.props, props ?? {});
    if (!parsed.success) {
      throw new GraphError(
        'invalid-props',
        `Свойства не по схеме (${where}) — ${v.summarize(parsed.issues)}`,
      );
    }
    return parsed.output;
  }
}
