import { Def } from '#core/kernel/def/def';
import type { AppSpec, NormalizedApp } from './app-def.types';

export type { AnyAppDef, AppSpec, NormalizedApp } from './app-def.types';

/**
 * Манифест доменного приложения (D-93): полный состав модулей ссылками на
 * Def и метка масштаба. Размещения, раскладки и версии нет; валидации в
 * `define` нет — нарушения ищет `arch:check`.
 */
export class AppDef<const S extends AppSpec = AppSpec> extends Def<S['name']> {
  readonly dmg = 'app';
  readonly modules: S['modules'];
  /** Метка масштаба (D-82); не задана — `undefined`. */
  readonly scale: string | undefined;

  constructor(spec: S) {
    super(spec);
    this.modules = spec.modules;
    this.scale = spec.scale;
  }

  static define<const S extends AppSpec>(spec: S): AppDef<S> {
    return new AppDef(spec);
  }

  normalize(): NormalizedApp {
    return {
      dmg: this.dmg,
      ...this.texts(),
      visible: this.visible,
      ...(this.scale === undefined ? {} : { scale: this.scale }),
      modules: this.modules.map((m) => m.name),
    };
  }
}
