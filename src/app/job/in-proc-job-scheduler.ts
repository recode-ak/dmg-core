import type { AnyJobDef } from '#core/domain/contracts/job-def';
import type { AnyModuleDef } from '#core/domain/contracts/module-def';
import type { Clock, Logger } from '../context';
import { type JobRunRepo, MemoryJobRunRepo } from './job-run-repo';
import { JobSchedulePlanner } from './job-schedule-planner';
import type { JobRunApi, JobScheduler } from './job-scheduler';
import { ScheduledJobRunner } from './scheduled-job-runner';

/** Зависимости планировщика в текущем процессе (D-71). */
export type InProcJobSchedulerDeps = {
  /** Исполнитель прогона — `runJob` приложения. */
  readonly api: JobRunApi;
  /** Def подключённых модулей: задания берутся из их `jobs`. */
  readonly modules: readonly AnyModuleDef[];
  /** Часы приложения (D-34). */
  readonly clock: Clock;
  readonly logger: Logger;
  /** История прогонов; по умолчанию — память, до рестарта процесса. */
  readonly store?: JobRunRepo;
  /** Задержка первого прогона после старта, мс (по умолчанию 3 минуты). */
  readonly startDelayMs?: number;
};

/** Источник записей планировщика в логгере. */
const SOURCE = 'job-scheduler';

/**
 * Планировщик заданий в текущем процессе (D-71): на каждое задание из `jobs`
 * модулей — свой `ScheduledJobRunner`; история прогонов — по имени задания.
 * @see docs/guides/job.md
 */
export class InProcJobScheduler implements JobScheduler {
  private readonly api: JobRunApi;
  private readonly modules: readonly AnyModuleDef[];
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly store: JobRunRepo;
  private readonly startDelayMs: number | undefined;

  private runners: ScheduledJobRunner[] = [];
  private started = false;

  constructor(deps: InProcJobSchedulerDeps) {
    this.api = deps.api;
    this.modules = deps.modules;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.store = deps.store ?? new MemoryJobRunRepo();
    this.startDelayMs = deps.startDelayMs;
  }

  /** Запускает задания всех модулей по расписанию. */
  start(): void {
    if (this.started) {
      throw new Error(
        'Планировщик уже запущен: вызовите stop() перед повторным start()',
      );
    }

    const tasks = this.tasks();
    this.started = true;

    const planner = new JobSchedulePlanner();

    for (const { module, job } of tasks) {
      this.logger.info(
        SOURCE,
        `Зарегистрирован job '${job.name}' (${describeSchedule(job)}): ${job.label}`,
      );

      const runner = new ScheduledJobRunner({
        module,
        job,
        api: this.api,
        planner,
        store: this.store,
        clock: this.clock,
        logger: this.logger,
        startDelayMs: this.startDelayMs,
      });
      runner.start();
      this.runners.push(runner);
    }
  }

  /** Останавливает все задания; идущие прогоны не прерываются. */
  stop(): void {
    for (const runner of this.runners) {
      runner.stop();
    }
    this.runners = [];
    this.started = false;
  }

  /** Пары «модуль — задание»; повтор имени задания — ошибка конфигурации. */
  private tasks(): { module: AnyModuleDef; job: AnyJobDef }[] {
    const owners = new Map<string, string>();
    const tasks: { module: AnyModuleDef; job: AnyJobDef }[] = [];

    for (const module of this.modules) {
      for (const job of module.jobs) {
        const owner = owners.get(job.name);
        if (owner !== undefined) {
          throw new Error(
            `Задание '${job.name}' объявлено и в модуле ${owner}, и в модуле ${module.name}: имена заданий должны быть уникальны (история прогонов — по имени)`,
          );
        }
        owners.set(job.name, module.name);
        tasks.push({ module, job });
      }
    }

    return tasks;
  }
}

/** Человекочитаемое описание расписания для логов. */
function describeSchedule(job: AnyJobDef): string {
  const schedule = job.schedule;
  switch (schedule.kind) {
    case 'interval':
      return schedule.alignUtc
        ? `каждые ${schedule.intervalMs}мс по сетке UTC`
        : `интервал ${schedule.intervalMs}мс`;
    case 'dailyAt':
      return `ежедневно ${pad(schedule.hour)}:${pad(schedule.minute)} UTC`;
    case 'weeklyAt':
      return `еженедельно пн-вс[${schedule.weekday}] ${pad(schedule.hour)}:${pad(schedule.minute)} UTC`;
    case 'monthlyAt':
      return `ежемесячно ${schedule.day}-го ${pad(schedule.hour)}:${pad(schedule.minute)} UTC`;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
