import type {
  AnyAggregateDef,
  NormalizedAggregate,
} from '../domain/aggregate/aggregate-def';
import type { AnyAppDef, NormalizedApp } from '../domain/contracts/app-def';
import type {
  AnyEventReactionDef,
  NormalizedEventReaction,
} from '../domain/contracts/event-reaction-def';
import type { AnyJobDef, NormalizedJob } from '../domain/contracts/job-def';
import type {
  AnyModuleDef,
  NormalizedModule,
} from '../domain/contracts/module-def';
import type {
  AnyUseCaseDef,
  NormalizedUseCase,
} from '../domain/contracts/use-case-def';
import type { AnyEventDef, NormalizedEvent } from '../domain/events/event-def';
import type {
  AnyPolicyDef,
  NormalizedPolicy,
} from '../domain/policy/policy-def';
import type { AnyRule, NormalizedRule } from '../domain/policy/rule';
import type {
  AnyDomainRule,
  NormalizedDomainRule,
} from '../domain/rules/domain-rule-def';
import type { AnyRulesDef, NormalizedRules } from '../domain/rules/rules-def';
import type { Def, NormalizedForm } from '../kernel/def/def';
import type { AnyErrorDef, NormalizedError } from '../kernel/errors/error-def';

export type {
  NormalizedAggregate,
  NormalizedTransition,
} from '../domain/aggregate/aggregate-def';
export type { NormalizedApp } from '../domain/contracts/app-def';
export type { NormalizedEventReaction } from '../domain/contracts/event-reaction-def';
export type { NormalizedJob } from '../domain/contracts/job-def';
export type { NormalizedModule } from '../domain/contracts/module-def';
export type { NormalizedUseCase } from '../domain/contracts/use-case-def';
export type { NormalizedEvent } from '../domain/events/event-def';
export type { NormalizedPolicy } from '../domain/policy/policy-def';
export type { NormalizedRule } from '../domain/policy/rule';
export type { NormalizedDomainRule } from '../domain/rules/domain-rule-def';
export type { NormalizedRules } from '../domain/rules/rules-def';
export type { NormalizedError } from '../kernel/errors/error-def';

export type AnyDef =
  | AnyErrorDef
  | AnyEventDef
  | AnyAggregateDef
  | AnyRule
  | AnyPolicyDef
  | AnyDomainRule
  | AnyRulesDef
  | AnyUseCaseDef
  | AnyEventReactionDef
  | AnyJobDef
  | AnyModuleDef
  | AnyAppDef;

export type NormalizedDef =
  | NormalizedError
  | NormalizedEvent
  | NormalizedAggregate
  | NormalizedRule
  | NormalizedPolicy
  | NormalizedDomainRule
  | NormalizedRules
  | NormalizedUseCase
  | NormalizedEventReaction
  | NormalizedJob
  | NormalizedModule
  | NormalizedApp;

/**
 * Сериализуемое представление Def (D-48) — основа графа и хеша: ссылки →
 * имена, схемы → JSON Schema, порядок ключей фиксирован. Последняя
 * перегрузка (любой `Def`, и чужой вид) обобщённая: TS подбирает сперва по
 * подтипу, класс вида попадает в неё раньше `Any*Def` — форма та же.
 */
export function normalize(def: AnyErrorDef): NormalizedError;
export function normalize(def: AnyEventDef): NormalizedEvent;
export function normalize(def: AnyAggregateDef): NormalizedAggregate;
export function normalize(def: AnyRule): NormalizedRule;
export function normalize(def: AnyPolicyDef): NormalizedPolicy;
export function normalize(def: AnyDomainRule): NormalizedDomainRule;
export function normalize(def: AnyRulesDef): NormalizedRules;
export function normalize(def: AnyUseCaseDef): NormalizedUseCase;
export function normalize(def: AnyEventReactionDef): NormalizedEventReaction;
export function normalize(def: AnyJobDef): NormalizedJob;
export function normalize(def: AnyModuleDef): NormalizedModule;
export function normalize(def: AnyAppDef): NormalizedApp;
export function normalize(def: AnyDef): NormalizedDef;
export function normalize<D extends Def>(def: D): ReturnType<D['normalize']>;
export function normalize(def: AnyDef | Def): NormalizedDef | NormalizedForm {
  return def.normalize();
}
