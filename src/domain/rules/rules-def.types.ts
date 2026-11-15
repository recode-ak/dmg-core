import type { DefOf, DefSpec, DefTexts } from '#core/kernel/def/def';
import type {
  AnyDomainRule,
  NormalizedDomainRule,
} from './domain-rule-def.types';

export type RulesSpec = DefSpec & {
  /** Доменные правила агрегата: ключ — имя, значение — правило. */
  readonly rules: { readonly [key: string]: AnyDomainRule };
};

export type NormalizedRules = DefTexts & {
  readonly dmg: 'rules';
  readonly visible: boolean;
  readonly rules: { readonly [key: string]: NormalizedDomainRule };
};

export type AnyRulesDef = DefOf<'rules', NormalizedRules> & {
  readonly rules: RulesSpec['rules'];
};
