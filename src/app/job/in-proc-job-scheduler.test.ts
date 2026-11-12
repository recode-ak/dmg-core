import { afterAll, describe, expect, test } from 'bun:test';
import { MemoryLogger } from '#core/testing/index';
import { InProcJobScheduler } from './in-proc-job-scheduler';
import { MemoryJobRunRepo } from './job-run-repo';
import {
  FakeJobApi,
  jobDefOf,
  moduleOf,
  sleep,
  waitFor,
} from './job-scheduler.fixture';

const every20ms = { kind: 'interval', intervalMs: 20 } as const;

function makeScheduler(
  modules: Parameters<typeof moduleOf>[1][] = [],
  names: string[] = [],
) {
  const api = new FakeJobApi();
  const logger = new MemoryLogger();
  const defs = modules.map((jobs, i) => moduleOf(names[i] ?? `m${i}`, jobs));
  const scheduler = new InProcJobScheduler({
    api,
    modules: defs,
    clock: () => Date.now(),
    logger,
    store: new MemoryJobRunRepo(),
    startDelayMs: 5,
  });
  activeSchedulers.push(scheduler);
  return { scheduler, api, logger };
}

const activeSchedulers: InProcJobScheduler[] = [];

afterAll(() => {
  for (const scheduler of activeSchedulers.splice(0)) scheduler.stop();
});

describe('InProcJobScheduler', () => {
  test('start запускает задания всех модулей; stop останавливает', async () => {
    const { scheduler, api, logger } = makeScheduler([
      [jobDefOf('job-a', every20ms)],
      [jobDefOf('job-b', every20ms)],
    ]);

    scheduler.start();
    await waitFor(() => api.starts('job-a') >= 1 && api.starts('job-b') >= 1);

    scheduler.stop();
    const aRuns = api.starts('job-a');
    const bRuns = api.starts('job-b');
    await sleep(60);
    expect(api.starts('job-a')).toBe(aRuns);
    expect(api.starts('job-b')).toBe(bRuns);

    // Регистрация залогирована
    expect(
      logger.records.some(
        (r) =>
          r.level === 'info' &&
          r.source === 'job-scheduler' &&
          r.message.includes('job-a'),
      ),
    ).toBe(true);
  });

  test('повторный start без stop — ошибка', () => {
    const { scheduler } = makeScheduler();

    scheduler.start();
    expect(() => scheduler.start()).toThrow('уже запущен');
  });

  test('после stop можно запустить снова', () => {
    const { scheduler } = makeScheduler([[jobDefOf('job-a', every20ms)]]);

    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.start()).not.toThrow();
  });

  test('два задания с одним именем в разных модулях — ошибка конфигурации в start', () => {
    const { scheduler } = makeScheduler([
      [jobDefOf('same-name', every20ms)],
      [jobDefOf('same-name', every20ms)],
    ]);

    expect(() => scheduler.start()).toThrow('same-name');
  });
});
