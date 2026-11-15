import type { GraphApp } from '#core/graph/domain/graph-app.types';
import { ExampleAppDef } from './example.app';

/**
 * Учебный вход команды `dmg-core graph` (D-96): граф учебного приложения без
 * поставщиков сверх домена. Файл — данные, поставляется с пакетом.
 */
export const ExampleGraph: GraphApp = { def: ExampleAppDef };

export default ExampleGraph;
