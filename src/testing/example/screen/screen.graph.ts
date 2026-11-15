import type { GraphApp } from '#core/graph/index';
import { ExampleAppDef } from '../example.app';
import { ScreenProvider } from './screen-provider';
import { TasksScreenDef } from './tasks.screen';

/**
 * Вход `dmg-core graph` образца расширения (D-96): граф учебного приложения и
 * поставщик «экран». Файл — данные, поставляется с пакетом.
 */
export const ScreenGraph: GraphApp = {
  def: ExampleAppDef,
  providers: [new ScreenProvider(ExampleAppDef, [TasksScreenDef])],
};

export default ScreenGraph;
