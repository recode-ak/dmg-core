import { type AnyEventDef, type AnyUseCaseDef, Def } from '#core/index';
import type { NormalizedScreen, ScreenSpec } from './screen-def.types';

export type {
  AnyScreenDef,
  NormalizedScreen,
  ScreenSpec,
} from './screen-def.types';

/**
 * Манифест экрана приложения UI: вид Def, добавленный снаружи пакета (ФР-9).
 * Наследник `Def` со своим `dmg` и `static define`, как виды домена.
 */
export class ScreenDef<N extends string = string> extends Def<N> {
  readonly dmg = 'screen';
  readonly uses: readonly AnyUseCaseDef[];
  readonly listens: readonly AnyEventDef[];

  constructor(spec: ScreenSpec<N>) {
    super(spec);
    this.uses = spec.uses;
    this.listens = spec.listens ?? [];
  }

  static define<const N extends string>(spec: ScreenSpec<N>): ScreenDef<N> {
    return new ScreenDef<N>(spec);
  }

  normalize(): NormalizedScreen {
    return {
      dmg: this.dmg,
      ...this.texts(),
      visible: this.visible,
      uses: this.uses.map((uc) => uc.name),
      listens: this.listens.map((e) => e.name),
    };
  }
}
