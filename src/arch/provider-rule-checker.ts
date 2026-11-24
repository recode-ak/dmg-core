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
 * ID правил, слоёв и доступов слоёв и отступления доступов (`debt`, D-111)
 * сверяются в конструкторе; нарушение ARC-13 — исключение.
 */
export class ProviderRuleChecker {
  private readonly rules: readonly GraphRule[];
  /** ID доступов с `debt` (D-111): только их нарушения снимает запись долга. */
  readonly debtIds: ReadonlySet<string>;
  private graph: Graph | GraphError | undefined;

  constructor(private readonly app: GraphApp) {
    const ids = new ProviderIds();
    this.rules = ProviderRuleChecker.verified(app.providers ?? [], ids);
    this.debtIds = ids.debtIds;
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

  // ID правил, слоёв и доступов поставщика (D-107, D-110) — по одной карте
  // префиксов: правило SCR-01 и слой SCR-02 одного поставщика можно, ID слоя
  // или доступа = ID правила — нет. Слои и доступы ID делят, как kernel и
  // domain (ARC-02): правила поставщика заявлены раньше его слоёв. Отступление
  // — свойство ID (D-111): доступ с `debt` — со своим `rule`, и этот ID не
  // делят слой или доступ без `debt`.
  private static verified(
    providers: readonly GraphProvider[],
    ids: ProviderIds,
  ): readonly GraphRule[] {
    const all: GraphRule[] = [];
    for (const provider of providers) {
      for (const rule of provider.rules?.() ?? []) {
        const at = `ARC-13: правило ${rule.id} поставщика ${provider.name}`;
        ids.rule(rule.id, provider.name, {
          at,
          form: `${at} — ID не по форме <ПРЕФИКС>-<NN>`,
          twice: `${at} объявлено дважды`,
        });
        all.push(rule);
      }
      for (const layer of provider.layers?.() ?? []) {
        const at = `ARC-13: слой ${layer.name} поставщика ${provider.name}`;
        ids.layer(layer.rule, provider.name, false, {
          at,
          ...ProviderIds.refusals(at, layer.rule),
        });
        const edges = [
          ...layer.sees.map((a) => ['sees', a] as const),
          ...(layer.seenBy ?? []).map((a) => ['seenBy', a] as const),
        ];
        for (const [edge, { layer: to, rule, debt }] of edges) {
          const access = `ARC-13: доступ ${edge} ${to} слоя ${layer.name} поставщика ${provider.name}`;
          if (rule === undefined) {
            if (debt === true)
              throw new Error(`${access} — debt без своего rule`);
            continue;
          }
          ids.layer(rule, provider.name, debt === true, {
            at: access,
            ...ProviderIds.refusals(access, rule),
          });
        }
      }
    }
    return all;
  }
}

/** Тексты отказа по ID: кто объявил (`at`), ID не по форме, ID повторён. */
type IdRefusals = {
  readonly at: string;
  readonly form: string;
  readonly twice: string;
};

/** Отказы ID слоя или доступа: плюс ID делят доступ с `debt` и слой или доступ без него. */
type LayerIdRefusals = IdRefusals & { readonly shared: string };

/**
 * Занятые ID поставщиков (ARC-13): префикс принадлежит одному поставщику (по
 * `name`), префиксы пакета зарезервированы; ID правила — один на правило, ID
 * слоя и доступа слоя не совпадает с ID правила, а слои и доступы его делят —
 * все с `debt` или все без (D-111). Нарушение — исключение.
 */
class ProviderIds {
  private readonly owners = new Map<string, string>();
  private readonly rules = new Set<string>();
  private readonly plain = new Set<string>();
  private readonly debt = new Set<string>();

  /** Тексты отказа ID слоя или доступа `id`, объявленного в `at`. */
  static refusals(at: string, id: string): Omit<LayerIdRefusals, 'at'> {
    return {
      form: `${at} — ID ${id} не по форме <ПРЕФИКС>-<NN>`,
      twice: `${at} — ID ${id} объявлен дважды`,
      shared: `${at} — ID ${id} делят доступ с debt и слой или доступ без него`,
    };
  }

  get debtIds(): ReadonlySet<string> {
    return this.debt;
  }

  rule(id: string, provider: string, refusals: IdRefusals): void {
    this.prefix(id, provider, refusals);
    if (this.rules.has(id)) throw new Error(refusals.twice);
    this.rules.add(id);
  }

  layer(
    id: string,
    provider: string,
    debt: boolean,
    refusals: LayerIdRefusals,
  ): void {
    this.prefix(id, provider, refusals);
    if (this.rules.has(id)) throw new Error(refusals.twice);
    const [own, other] = debt
      ? [this.debt, this.plain]
      : [this.plain, this.debt];
    if (other.has(id)) throw new Error(refusals.shared);
    own.add(id);
  }

  private prefix(id: string, provider: string, refusals: IdRefusals): void {
    if (!RULE_ID.test(id)) throw new Error(refusals.form);
    const [prefix = ''] = id.split('-');
    if (RESERVED.has(prefix)) {
      throw new Error(
        `${refusals.at} — префикс ${prefix} занят правилами пакета dmg-core`,
      );
    }
    const owner = this.owners.get(prefix) ?? provider;
    if (owner !== provider) {
      throw new Error(
        `ARC-13: префикс ${prefix} у двух поставщиков — ${owner} и ${provider}`,
      );
    }
    this.owners.set(prefix, owner);
  }
}
