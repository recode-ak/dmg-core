import type { AnyAppDef } from '../../domain/contracts/app-def';
import type { GraphProvider } from '../graph-provider';

/**
 * Вход сборки графа приложения (D-95): манифест и поставщики сверх домена.
 * `ArchApp` расширяет этот тип: конфиг проверок собирается из входа графа.
 */
export type GraphApp = {
  readonly def: AnyAppDef;
  readonly providers?: readonly GraphProvider[];
};
