import {
  type AnyJobDef,
  JobDef,
  type JobSchedule,
} from '#core/domain/contracts/job-def';
import {
  type AnyModuleDef,
  ModuleDef,
} from '#core/domain/contracts/module-def';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { ok } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import type { JobRunApi } from './job-scheduler';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ждёт предиката (поллинг с дедлайном); не дождались — `Error`. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`waitFor: условие не выполнено за ${timeoutMs}мс`);
}

export function jobDefOf(name: string, schedule: JobSchedule): AnyJobDef {
  return JobDef.define({
    name,
    label: 'Тестовое задание',
    description: 'Задание для проверки планировщика.',
    schedule,
  });
}

export function moduleOf(
  name: string,
  jobs: readonly AnyJobDef[],
): AnyModuleDef {
  return ModuleDef.define({
    name,
    label: 'Тестовый модуль',
    description: 'Модуль для проверки планировщика.',
    dependsOn: [],
    aggregates: [],
    useCases: [],
    reactions: [],
    jobs,
  });
}

export type Outcome = 'ok' | 'err' | 'throw';

/** Фейк `api.runJob`: считает старты по имени задания, исход — по номеру вызова. */
export class FakeJobApi {
  readonly calls: { module: AnyModuleDef; job: AnyJobDef; trace: Trace }[] = [];

  constructor(
    private readonly options: {
      readonly durationMs?: number;
      readonly outcome?: (call: number) => Outcome;
    } = {},
  ) {}

  /** Число стартов (всех попыток) задания или всех заданий. */
  starts(jobName?: string): number {
    return this.calls.filter(
      (c) => jobName === undefined || c.job.name === jobName,
    ).length;
  }

  readonly runJob: JobRunApi['runJob'] = async (module, job, trace) => {
    this.calls.push({ module, job, trace });
    const call = this.calls.length;
    if (this.options.durationMs) await sleep(this.options.durationMs);
    const outcome = this.options.outcome?.(call) ?? 'ok';
    if (outcome === 'throw') throw new Error('модуль не подключён');
    if (outcome === 'err') return CoreErrors.SERVER_INTERNAL.err();
    return ok({ processed: 1, failed: 0 });
  };
}
