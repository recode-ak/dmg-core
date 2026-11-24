import {
  CreateTaskUcDef,
  ListTasksUcDef,
  TaskEvents,
} from '../platform/domain/todo/contract';
import { ScreenDef } from './screen-def';

/** Манифест экрана «Мои задачи»: список обновляется по событию «задача создана». */
export const TasksScreenDef = ScreenDef.define({
  name: 'tasks',
  label: 'Мои задачи',
  description: 'Список задач пользователя; обновляется, когда задача создана.',
  visible: true,
  uses: [ListTasksUcDef, CreateTaskUcDef],
  listens: [TaskEvents.created],
});
