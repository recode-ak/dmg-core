import type { AnyAggregateDef } from '../../domain/aggregate/aggregate-def';
import type { AnyAppDef } from '../../domain/contracts/app-def';
import type { AnyModuleDef } from '../../domain/contracts/module-def';
import type { AnyEventDef } from '../../domain/events/event-def';
import type { AnyDomainRule } from '../../domain/rules/domain-rule-def';
import { CoreErrors } from '../../kernel/errors/core-errors';
import type { AnyErrorDef } from '../../kernel/errors/error-def';
import { type AnyOperationDef, DefIndex } from '../def-index';
import { DOMAIN_PROVIDER } from './domain-kinds';

/**
 * `id` узла графа по Def (D-95): единственное место правил дерева — FQN
 * домена под корнем приложения. Def вне модулей приложения и базовая ошибка
 * пакета получают внешний `id` под корнем поставщика.
 */
export class DomainIds {
  private readonly root: string;
  private readonly index: DefIndex;

  constructor(app: AnyAppDef) {
    this.root = app.name;
    this.index = DefIndex.from(app.modules);
  }

  app(): string {
    return this.root;
  }

  module(def: AnyModuleDef): string {
    return `${this.root}/${def.name}`;
  }

  aggregate(def: AnyAggregateDef): string {
    return this.inModule(def);
  }

  /** UC, ER и Job — дети модуля: с агрегатом операцию связывает ребро. */
  operation(def: AnyOperationDef): string {
    return this.inModule(def);
  }

  event(def: AnyEventDef): string {
    return this.inAggregate(def, def, this.index.eventLocalName(def), def.name);
  }

  error(def: AnyErrorDef): string {
    if (Object.values<AnyErrorDef>(CoreErrors).includes(def)) {
      return `${DOMAIN_PROVIDER}/${def.code}`;
    }
    return this.inAggregate(def, def, def.code, def.code);
  }

  /** По агрегату-владельцу ошибки правила (D-40), а не по ссылающемуся UC. */
  rule(def: AnyDomainRule): string {
    return this.inAggregate(def, def.error, def.name, def.name);
  }

  private inModule(def: AnyAggregateDef | AnyOperationDef): string {
    const owner = this.index.moduleOf(def);
    if (!owner) return DomainIds.orphan(def, def.name);
    return `${this.module(owner)}/${def.name}`;
  }

  private inAggregate(
    def: { readonly dmg: string },
    owned: AnyEventDef | AnyErrorDef,
    segment: string,
    orphanName: string,
  ): string {
    const owner = this.index.aggregateOf(owned);
    if (!owner) return DomainIds.orphan(def, orphanName);
    return `${this.aggregate(owner)}/${segment}`;
  }

  private static orphan(def: { readonly dmg: string }, name: string): string {
    return `${DOMAIN_PROVIDER}/orphan/${def.dmg}/${name}`;
  }
}
