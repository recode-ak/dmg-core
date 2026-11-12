import type { Timestamp } from '#core/kernel/time/timestamp';

/**
 * Порт истории прогонов (D-71): момент последнего прогона по имени задания.
 * Планировщик по нему считает первый запуск и догон упущенного; время —
 * `Timestamp` (D-34), хранилище со строковыми датами конвертирует на своей
 * границе.
 * @see docs/guides/job.md
 */
export type JobRunRepo = {
  getLastRunAt(jobName: string): Timestamp | undefined;

  setLastRunAt(jobName: string, at: Timestamp): void;
};

/** История прогонов в памяти: рестарт процесса её забывает (D-71). */
export class MemoryJobRunRepo implements JobRunRepo {
  private readonly lastRuns = new Map<string, Timestamp>();

  getLastRunAt(jobName: string): Timestamp | undefined {
    return this.lastRuns.get(jobName);
  }

  setLastRunAt(jobName: string, at: Timestamp): void {
    this.lastRuns.set(jobName, at);
  }
}
