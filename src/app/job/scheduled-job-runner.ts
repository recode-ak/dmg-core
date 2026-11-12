import type { AnyJobDef } from '#core/domain/contracts/job-def';
import type { AnyModuleDef } from '#core/domain/contracts/module-def';
import { Trace } from '#core/kernel/trace/trace';
import type { Clock, Logger } from '../context';
import type { JobRunRepo } from './job-run-repo';
import type { JobSchedulePlanner } from './job-schedule-planner';
import type { JobRunApi } from './job-scheduler';

/** Стартовая задержка по умолчанию: не конкурировать с кодом запуска приложения. */
export const DEFAULT_START_DELAY_MS = 3 * 60_000;

/** Зависимости раннера одного задания. */
export type ScheduledJobRunnerDeps = {
  readonly module: AnyModuleDef;
  readonly job: AnyJobDef;
  readonly api: JobRunApi;
  readonly planner: JobSchedulePlanner;
  /** Хранилище моментов прогонов (переживание перезагрузки — на приложении). */
  readonly store: JobRunRepo;
  /** Часы приложения: раннер читает только их (D-34). */
  readonly clock: Clock;
  readonly logger: Logger;
  /** Задержка первого прогона после старта (мс), по умолчанию 3 минуты. */
  readonly startDelayMs?: number;
};

/** Источник записей раннера в логгере. */
const SOURCE = 'job-runner';

/**
 * D-71: владеет жизнью одного задания — считает следующий запуск, прогоняет
 * через `runJob`, пишет `lastRunAt` и армит следующий.
 * @see docs/guides/job.md
 */
export class ScheduledJobRunner {
  private readonly deps: ScheduledJobRunnerDeps;
  private readonly startDelayMs: number;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private started = false;

  constructor(deps: ScheduledJobRunnerDeps) {
    this.deps = deps;
    this.startDelayMs = deps.startDelayMs ?? DEFAULT_START_DELAY_MS;
  }

  /** Запускает задание по расписанию. Повторный вызов игнорируется. */
  start(): void {
    if (this.started) return;
    this.started = true;

    const lastRun = this.deps.store.getLastRunAt(this.job.name);
    const current = this.deps.clock();

    // runAtStart без истории: первый прогон через стартовую задержку
    if (lastRun === undefined && this.isRunAtStart()) {
      this.arm(this.startDelayMs);
      return;
    }

    const next = this.deps.planner.nextRunAfter(
      this.job.schedule,
      lastRun ?? current,
    );

    if (next <= current) {
      // Misfire: упущенный запуск — один догоняющий прогон
      this.arm(this.startDelayMs);
    } else {
      this.arm(next - current);
    }
  }

  /** Останавливает задание (снимает таймер). Идущий прогон не прерывается. */
  stop(): void {
    this.started = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private get job(): AnyJobDef {
    return this.deps.job;
  }

  private isRunAtStart(): boolean {
    const schedule = this.job.schedule;
    return schedule.kind === 'interval' && schedule.runAtStart === true;
  }

  private arm(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce();
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const res = await this.deps.api.runJob(
        this.deps.module,
        this.job,
        Trace.forJob(this.job),
      );
      if (!res.ok) {
        this.deps.logger.warn(
          SOURCE,
          `Ошибка прогона job '${this.job.name}': ${res.error.code}`,
        );
      }
    } catch (err) {
      this.deps.logger.warn(
        SOURCE,
        `Ошибка прогона job '${this.job.name}': ${String(err)}`,
      );
    } finally {
      this.running = false;
      // lastRunAt фиксируем и при ошибке: рестарт не должен зацикливать догон
      this.deps.store.setLastRunAt(this.job.name, this.deps.clock());
      if (this.started) {
        const next = this.deps.planner.nextRunAfter(
          this.job.schedule,
          this.deps.clock(),
        );
        this.arm(Math.max(0, next - this.deps.clock()));
      }
    }
  }
}
