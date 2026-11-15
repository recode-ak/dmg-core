import type { Graph, GraphRule } from '#core/graph/index';

/** `SCR-01`: экран без единого UC. Префикс `SCR` принадлежит этому поставщику (ARC-13). */
export class ScreenWithoutUcRule implements GraphRule {
  readonly id = 'SCR-01';

  check(graph: Graph): readonly string[] {
    return graph
      .nodes()
      .filter(
        (n) => n.kind === 'screen' && graph.outgoing(n.id, 'uses').length === 0,
      )
      .map((n) => `экран ${n.id} не вызывает ни одного UC`);
  }
}
