import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { JobSchedule } from '#core/domain/contracts/job-def';
import { MemoryLogger } from '#core/testing/index';
import { MemoryJobRunRepo } from './job-run-repo';
import { JobSchedulePlanner } from './job-schedule-planner';
import {
  FakeJobApi,
  jobDefOf,
  moduleOf,
  sleep,
  waitFor,
} from './job-scheduler.fixture';
import { ScheduledJobRunner } from './scheduled-job-runner';

const START_DELAY_MS = 10;
const JOB_NAME = 'test-job';

function makeRunner(
  schedule: JobSchedule,
  options: ConstructorParameters<typeof FakeJobApi>[0] = {},
  store = new MemoryJobRunRepo(),
) {
  const job = jobDefOf(JOB_NAME, schedule);
  const module = moduleOf('test-module', [job]);
  const api = new FakeJobApi(options);
  const logger = new MemoryLogger();
  const runner = new ScheduledJobRunner({
    module,
    job,
    api,
    planner: new JobSchedulePlanner(),
    store,
    clock: () => Date.now(),
    logger,
    startDelayMs: START_DELAY_MS,
  });
  return { runner, api, store, logger, module, job };
}

// Активные раннеры — гасим после каждого теста
const active: ScheduledJobRunner[] = [];

afterEach(() => {
  for (const runner of active.splice(0)) runner.stop();
  setSystemTime();
});

describe('ScheduledJobRunner — interval', () => {
  test('первый прогон — после интервала от старта, затем по интервалу', async () => {
    const { runner, api } = makeRunner({ kind: 'interval', intervalMs: 30 });
    active.push(runner);

    runner.start();

    await sleep(15);
    expect(api.starts()).toBe(0); // ещё рано

    await waitFor(() => api.starts() >= 1);
    await waitFor(() => api.starts() >= 2);
    expect(api.starts()).toBeGreaterThanOrEqual(2);
  });

  test('runAtStart без lastRunAt: первый прогон через стартовую задержку', async () => {
    const { runner, api } = makeRunner({
      kind: 'interval',
      intervalMs: 60_000,
      runAtStart: true,
    });
    active.push(runner);

    runner.start();

    await waitFor(() => api.starts() >= 1, 500);
    expect(api.starts()).toBe(1);
  });

  test('runAtStart со свежим lastRunAt: быстрого прогона нет — ждём остаток интервала', async () => {
    const intervalMs = 60;
    const store = new MemoryJobRunRepo();
    // последний прогон — половину интервала назад
    store.setLastRunAt(JOB_NAME, Date.now() - intervalMs / 2);
    const { runner, api } = makeRunner(
      { kind: 'interval', intervalMs, runAtStart: true },
      {},
      store,
    );
    active.push(runner);

    runner.start();

    // Стартовая задержка прошла, но интервал с lastRun ещё не истёк:
    // прогон ждёт остаток интервала, а не стартовую задержку
    await sleep(START_DELAY_MS + 10);
    expect(api.starts()).toBe(0);

    await waitFor(() => api.starts() >= 1);
    expect(api.starts()).toBeGreaterThanOrEqual(1);
  });

  test('прогон идёт через api.runJob со своим модулем и заданием, lastRunAt записывается', async () => {
    const before = Date.now();
    const { runner, api, store, module, job } = makeRunner({
      kind: 'interval',
      intervalMs: 20,
    });
    active.push(runner);

    runner.start();
    await waitFor(() => api.starts() >= 1);

    expect(api.calls[0]?.module).toBe(module);
    expect(api.calls[0]?.job).toBe(job);
    expect(store.getLastRunAt(JOB_NAME)).toBeGreaterThanOrEqual(before);
  });

  test('stop(): прогоны прекращаются', async () => {
    const { runner, api } = makeRunner({ kind: 'interval', intervalMs: 20 });

    runner.start();
    await waitFor(() => api.starts() >= 1);
    runner.stop();

    const startsAtStop = api.starts();
    await sleep(60);
    expect(api.starts()).toBe(startsAtStop);
  });

  test('сбой прогона — и Err, и исключение: warn, lastRunAt записан, следующий прогон происходит', async () => {
    // первый прогон — Err(DomainError), второй — исключение runJob
    const { runner, api, store, logger } = makeRunner(
      { kind: 'interval', intervalMs: 20 },
      { outcome: (call) => (call === 1 ? 'err' : 'throw') },
    );
    active.push(runner);

    runner.start();
    await waitFor(() => api.starts() >= 3);
    expect(api.starts()).toBeGreaterThanOrEqual(3);

    const warns = logger.records.filter(
      (r) => r.level === 'warn' && r.source === 'job-runner',
    );
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(warns.every((r) => r.message.includes(JOB_NAME))).toBe(true);
    // Один warn — Err из runJob (код ошибки), другой — текст исключения
    expect(warns.some((r) => r.message.includes('SERVER_INTERNAL'))).toBe(true);
    expect(warns.some((r) => r.message.includes('модуль не подключён'))).toBe(
      true,
    );
    expect(store.getLastRunAt(JOB_NAME)).toBeDefined();
  });

  test('долгий прогон: параллельный запуск не начинается', async () => {
    const { runner, api } = makeRunner(
      { kind: 'interval', intervalMs: 5 },
      { durationMs: 60 },
    );
    active.push(runner);

    runner.start();
    await sleep(40); // несколько тиков интервала внутри одного прогона

    expect(api.starts()).toBe(1);
  });
});

describe('ScheduledJobRunner — календарные расписания', () => {
  const daily: JobSchedule = { kind: 'dailyAt', hour: 12, minute: 0 };

  test('misfire: упущенный ежедневный запуск выполняется после стартовой задержки', async () => {
    // Сейчас 2026-01-10 13:00Z; lastRun — вчера 12:00 → сегодняшний 12:00 упущен
    setSystemTime(new Date('2026-01-10T13:00:00.000Z'));
    const store = new MemoryJobRunRepo();
    store.setLastRunAt(JOB_NAME, Date.UTC(2026, 0, 9, 12, 0));
    const { runner, api } = makeRunner(daily, {}, store);
    active.push(runner);

    runner.start();

    await waitFor(() => api.starts() >= 1, 500);
    expect(api.starts()).toBe(1);
  });

  test('misfire multi: упущено несколько суток — ровно один догоняющий прогон', async () => {
    setSystemTime(new Date('2026-01-10T13:00:00.000Z'));
    const store = new MemoryJobRunRepo();
    store.setLastRunAt(JOB_NAME, Date.UTC(2026, 0, 5, 12, 0)); // 5 дней назад
    const { runner, api } = makeRunner(daily, {}, store);
    active.push(runner);

    runner.start();

    await waitFor(() => api.starts() >= 1, 500);
    await sleep(START_DELAY_MS * 4);
    expect(api.starts()).toBe(1); // не 5 — один догоняющий
  });

  test('без misfire: время впереди — прогона нет до расписания', async () => {
    setSystemTime(new Date('2026-01-10T10:00:00.000Z'));
    const { runner, api } = makeRunner(daily);
    active.push(runner);

    runner.start();

    await sleep(START_DELAY_MS * 3);
    expect(api.starts()).toBe(0);
  });

  test('без lastRunAt и с прошедшим временем сегодня: это не misfire — ждём завтра', async () => {
    // lastRun нет → nextRunAfter(now) всегда в будущем → прогон только завтра
    setSystemTime(new Date('2026-01-10T13:00:00.000Z'));
    const { runner, api } = makeRunner(daily);
    active.push(runner);

    runner.start();

    await sleep(START_DELAY_MS * 3);
    expect(api.starts()).toBe(0);
  });
});
