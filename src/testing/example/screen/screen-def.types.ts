import type {
  AnyEventDef,
  AnyUseCaseDef,
  DefSpec,
  DefTexts,
} from '#core/index';
import type { ScreenDef } from './screen-def';

/** Спека экрана: UC, которые он вызывает, и события, которые слушает. */
export type ScreenSpec<N extends string = string> = DefSpec<N> & {
  readonly uses: readonly AnyUseCaseDef[];
  readonly listens?: readonly AnyEventDef[];
};

/** Любой Def экрана — структурный тип публичных членов (как `AnyUseCaseDef`). */
export type AnyScreenDef = {
  readonly [K in keyof ScreenDef]: ScreenDef[K];
};

/** Сериализуемая форма экрана; ссылки — именами, как у реакции. */
export type NormalizedScreen = DefTexts & {
  readonly dmg: 'screen';
  readonly visible: boolean;
  readonly uses: readonly string[];
  readonly listens: readonly string[];
};
