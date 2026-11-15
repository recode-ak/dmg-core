// Правила поставщиков графа в `arch:check` (D-97, ARC-13). Правила берутся
// только у `app.providers`: поставщика домена добавляет `AppGraph`, правил у
// него нет. Граф строится лениво, один раз и только при наличии правил;
// `GraphError` сборки (например, коллизия имён MAN-16) — нарушение, не отказ.
import { AppGraph } from '../graph/domain/app-graph';
import type { GraphApp } from '../graph/domain/graph-app.types';
import type { Graph } from '../graph/graph';
import { GraphError } from '../graph/graph-error';
import type { GraphProvider } from '../graph/graph-provider';
import type { GraphRule } from '../graph/graph-rule.types';
import { PACKAGE_RULE_PREFIXES, Violation } from './violation';

const RULE_ID = /^[A-Z][A-Z0-9]+-\d{2}$/;
const RESERVED = new Set<string>(PACKAGE_RULE_PREFIXES);

/**
 * Проверка графа приложения правилами поставщиков: нарушение — с ID правила.
 * ID сверяются в конструкторе; нарушение ARC-13 — исключение.
 */
export class ProviderRuleChecker {
  private readonly rules: readonly GraphRule[];
  private graph: Graph | GraphError | undefined;

  constructor(private readonly app: GraphApp) {
    this.rules = ProviderRuleChecker.verified(app.providers ?? []);
  }

  /** Поставщики — в порядке `providers`, правила и сообщения — как объявлены. */
  check(): Violation[] {
    if (this.rules.length === 0) return [];
    this.graph ??= this.build();
    const graph = this.graph;
    if (graph instanceof GraphError) {
      return [
        new Violation(
          'ARC-13',
          `граф приложения ${this.app.def.name} не собран, правила поставщиков не проверены — ${graph.message}`,
        ),
      ];
    }
    return this.rules.flatMap((rule) =>
      rule.check(graph).map((message) => new Violation(rule.id, message)),
    );
  }

  // Другие исключения (не `GraphError`) — дефект поставщика, пробрасываются.
  private build(): Graph | GraphError {
    try {
      return new AppGraph(this.app).build();
    } catch (error) {
      if (error instanceof GraphError) return error;
      throw error;
    }
  }

  // Префикс ID принадлежит одному поставщику (по `name`), префиксы пакета
  // зарезервированы; отсюда же — отказ при совпадении с ID правила пакета.
  private static verified(
    providers: readonly GraphProvider[],
  ): readonly GraphRule[] {
    const owners = new Map<string, string>();
    const ids = new Set<string>();
    const all: GraphRule[] = [];
    for (const provider of providers) {
      for (const rule of provider.rules?.() ?? []) {
        const at = `ARC-13: правило ${rule.id} поставщика ${provider.name}`;
        if (!RULE_ID.test(rule.id)) {
          throw new Error(`${at} — ID не по форме <ПРЕФИКС>-<NN>`);
        }
        const [prefix = ''] = rule.id.split('-');
        if (RESERVED.has(prefix)) {
          throw new Error(
            `${at} — префикс ${prefix} занят правилами пакета dmg-core`,
          );
        }
        const owner = owners.get(prefix) ?? provider.name;
        if (owner !== provider.name) {
          throw new Error(
            `ARC-13: префикс ${prefix} у двух поставщиков — ${owner} и ${provider.name}`,
          );
        }
        if (ids.has(rule.id)) throw new Error(`${at} объявлено дважды`);
        owners.set(prefix, owner);
        ids.add(rule.id);
        all.push(rule);
      }
    }
    return all;
  }
}
