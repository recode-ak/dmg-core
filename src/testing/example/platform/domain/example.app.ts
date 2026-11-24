import { AppDef } from '#core/domain/contracts/app-def';
import { TodoModuleDef } from './todo';
import { UsersModuleDef } from './users';

/** Манифест учебного приложения (D-93): полный состав модулей. */
export const ExampleAppDef = AppDef.define({
  name: 'example',
  label: 'Учебное приложение',
  description: 'Задачи пользователей: модули todo и users.',
  modules: [TodoModuleDef, UsersModuleDef],
});
