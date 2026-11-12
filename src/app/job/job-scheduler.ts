import type { Identified } from '#core/kernel/caller/caller';
import type { ApiApp } from '../api-app/api-app';

/** Исполнитель прогона задания: приложению нужен только `runJob` (D-71). */
export type JobRunApi = Pick<ApiApp<Identified>, 'runJob'>;

/**
 * Порт планировщика заданий (D-71): `start()` запускает задания модулей по
 * расписанию, `stop()` снимает таймеры (идущий прогон не прерывает).
 * @see docs/guides/job.md
 */
export type JobScheduler = {
  start(): void;
  stop(): void;
};
