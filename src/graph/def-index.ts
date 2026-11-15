import type { AnyAggregateDef } from '../domain/aggregate/aggregate-def';
import type { AnyModuleDef } from '../domain/contracts/module-def';
import type { AnyOperationDef } from '../domain/contracts/operation-def.types';
import type { AnyEventDef } from '../domain/events/event-def';
import type { AnyDomainRule } from '../domain/rules/domain-rule-def';
import type { AnyErrorDef } from '../kernel/errors/error-def';

export type { AnyOperationDef };

/**
 * Def приложения по ссылкам, с владельцами. Модули — замыкание корней по
 * `dependsOn` (цикл не мешает обходу). Сравнение по ссылке на Def: два
 * разных Def с одним именем — разные Def (их ловит `arch:check`).
 */
export class DefIndex {
  private readonly moduleOwner = new Map<
    AnyAggregateDef | AnyOperationDef,
    AnyModuleDef
  >();
  private readonly aggregateOwner = new Map<
    AnyEventDef | AnyErrorDef,
    AnyAggregateDef
  >();

  private constructor(readonly modules: readonly AnyModuleDef[]) {
    for (const m of modules) {
      for (const a of m.aggregates) {
        this.moduleOwner.set(a, m);
        for (const e of Object.values(a.events)) this.aggregateOwner.set(e, a);
        for (const e of Object.values(a.errors)) this.aggregateOwner.set(e, a);
      }
      for (const op of m.operations()) this.moduleOwner.set(op, m);
    }
  }

  static from(roots: readonly AnyModuleDef[]): DefIndex {
    const modules: AnyModuleDef[] = [];
    const visit = (m: AnyModuleDef): void => {
      if (modules.includes(m)) return;
      modules.push(m);
      for (const dep of m.dependsOn) visit(dep);
    };
    for (const m of roots) visit(m);
    return new DefIndex(modules);
  }

  /** Операции всех модулей индекса. */
  operations(): readonly AnyOperationDef[] {
    return this.modules.flatMap((m) => m.operations());
  }

  /** Модуль-владелец агрегата или операции; вне индекса — `undefined`. */
  moduleOf(def: AnyAggregateDef | AnyOperationDef): AnyModuleDef | undefined {
    return this.moduleOwner.get(def);
  }

  /** Агрегат-владелец события или ошибки; вне индекса — `undefined`. */
  aggregateOf(def: AnyEventDef | AnyErrorDef): AnyAggregateDef | undefined {
    return this.aggregateOwner.get(def);
  }

  /**
   * Имя события внутри агрегата-владельца: остаток FQN после `<m>.<a>.`
   * (MAN-08). FQN не по правилу или событие вне индекса — полное имя.
   */
  eventLocalName(def: AnyEventDef): string {
    const aggregate = this.aggregateOf(def);
    const owner = aggregate && this.moduleOf(aggregate);
    if (!aggregate || !owner) return def.name;
    const prefix = `${owner.localId(aggregate)}.`;
    const rest = def.name.slice(prefix.length);
    const byRule = def.name.startsWith(prefix) && rest !== '';
    return byRule && !rest.includes('.') ? rest : def.name;
  }

  /**
   * Id доменного правила в сообщениях проверок (D-40): `module.aggregate.name`
   * по агрегату-владельцу его ошибки (DOM-16), а не по модулю ссылающегося UC.
   * Правила с одним `name` у разных агрегатов модуля различаются. Ошибка вне
   * модулей индекса — `?.?.name`; `id` узла графа даёт `DomainIds`.
   */
  ruleId(rule: AnyDomainRule): {
    readonly id: string;
    readonly module: string;
  } {
    const aggregate = this.aggregateOf(rule.error);
    const owner = aggregate && this.moduleOf(aggregate);
    if (!aggregate || !owner) return { id: `?.?.${rule.name}`, module: '?' };
    return {
      id: `${owner.localId(aggregate)}.${rule.name}`,
      module: owner.name,
    };
  }
}
