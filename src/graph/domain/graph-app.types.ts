import type { AnyAppDef } from '../../domain/contracts/app-def';
import type { GraphProvider } from '../graph-provider';

/**
 * Вход сборки графа приложения (D-95): манифест и поставщики сверх домена.
 * Имя поля `def` — как у `ArchApp.def`.
 */
export type GraphApp = {
  readonly def: AnyAppDef;
  readonly providers?: readonly GraphProvider[];
};
