import type { DefSpec, DefTexts } from '#core/kernel/def/def';
import type { AppDef } from './app-def';
import type { AnyModuleDef } from './module-def.types';

/** Спека приложения (D-93): тексты, признак видимости, состав и масштаб. */
export type AppSpec = DefSpec & {
  /** Полный состав модулей приложения (D-93). */
  readonly modules: readonly AnyModuleDef[];
  /** Метка масштаба (D-93; D-82 u7-school): слово словаря проекта, не перечень фреймворка. */
  readonly scale?: string;
};

/** Сериализуемая форма приложения: модули — именами. */
export type NormalizedApp = DefTexts & {
  readonly dmg: 'app';
  readonly visible: boolean;
  readonly scale?: string;
  readonly modules: readonly string[];
};

/** Любой Def приложения — структурный тип публичных членов. */
export type AnyAppDef = { readonly [K in keyof AppDef]: AppDef[K] };
