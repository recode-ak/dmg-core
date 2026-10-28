import { beforeEach, describe, expect, test } from 'bun:test';
import type { Command } from '#core/domain/contracts/command';
import { JobDef } from '#core/domain/contracts/job-def';
import { ModuleDef } from '#core/domain/contracts/module-def';
import type {
  OutputOf,
  UseCaseErrorOf,
} from '#core/domain/contracts/use-case-def';
import {
  type Caller,
  DelegateCaller,
  GuestCaller,
  SystemCaller,
  UserCaller,
} from '#core/kernel/caller/caller';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { ok, type Result } from '#core/kernel/result/result';
import { Trace } from '#core/kernel/trace/trace';
import { TEST_NOW, testAppContext } from '#core/testing/app-context';
import {
  ArchiveDoneTasksJobDef,
  CompleteTaskUcDef,
  CreateTaskUcDef,
  ListTasksUcDef,
  ReleaseRemovedUserTasksErDef,
  TaskErrors,
} from '#core/testing/example/todo/index';
import { UserEvents } from '#core/testing/example/users/index';
import { expectErr, expectOk } from '#core/testing/index';
import { MemoryBus } from '#core/testing/memory-bus';
import { T0, TASK } from '../app.fixture';
import type { ModuleDeps } from '../context';
import { ModuleFacades } from '../facade/module-facades';
import { JobFromDef, type JobRun } from '../job/job-from-def';
import { ReactionFromDef } from '../reaction/reaction-from-def';
import {
  DEFAULT_REPLAY_TTL_MS,
  type ReplayStore,
} from '../replay/replay-store';
import { UseCaseFromDef } from '../use-case/use-case-from-def';
import {
  type AnyModuleFromDef,
  ModuleFromDef,
  type ModuleMap,
} from './module-from-def';

const MiniModuleDef = ModuleDef.define({
  name: 'mini',
  label: 'Мини',
  description: 'Модуль для проверки карты Def → класс.',
  dependsOn: [],
  aggregates: [],
  useCases: [CompleteTaskUcDef],
  reactions: [ReleaseRemovedUserTasksErDef],
  jobs: [ArchiveDoneTasksJobDef],
});

/** Модуль без зависимостей — фасадов нет. */
const facades = new ModuleFacades();

type Deps = ModuleDeps & {
  reacted: string[];
  /** След каждого прогона Job — то, что передал вызывающий `runJob`. */
  ran: Trace[];
};
/** Субъект, которого даёт приложение. */
type User = { readonly uuid: string; hasRole(role: 'admin'): boolean };
type Map = ModuleMap<typeof MiniModuleDef, Deps, User>;

class CompleteTask extends UseCaseFromDef<
  typeof CompleteTaskUcDef,
  Deps,
  never
> {
  constructor(deps: Deps, module: typeof MiniModuleDef) {
    super(CompleteTaskUcDef, deps, module);
  }
  protected async load() {
    return TaskErrors.NOT_FOUND.err({ taskId: 'x' });
  }
  protected async execute() {
    return ok({});
  }
}

class ReleaseRemoved extends ReactionFromDef<
  typeof ReleaseRemovedUserTasksErDef,
  Deps
> {
  constructor(deps: Deps, module: typeof MiniModuleDef) {
    super(ReleaseRemovedUserTasksErDef, deps, module);
  }
  protected async react() {
    this.resolve.reacted.push(this.def.name);
    return ok();
  }
}

class ArchiveDone extends JobFromDef<typeof ArchiveDoneTasksJobDef, Deps> {
  constructor(deps: Deps, module: typeof MiniModuleDef) {
    super(ArchiveDoneTasksJobDef, deps, module);
  }
  protected run(job: JobRun) {
    this.resolve.ran.push(job.trace);
    return job.forEach([], async () => ok());
  }
}

const map = {
  useCases: { completeTask: CompleteTask },
  reactions: { releaseRemovedUserTasks: ReleaseRemoved },
  jobs: { archiveDoneTasks: ArchiveDone },
} satisfies Map;

let deps: Deps;
let mini: ModuleFromDef<typeof MiniModuleDef, Deps, User>;

beforeEach(() => {
  deps = { app: testAppContext().app, facades, reacted: [], ran: [] };
  mini = new ModuleFromDef<typeof MiniModuleDef, Deps, User>(
    MiniModuleDef,
    map,
    deps,
  );
});

const REQ = Trace.fromRequest({ requestId: 'r-1' });
const user: User = { uuid: 'u-1', hasRole: () => true };

describe('ModuleFromDef', () => {
  test('операции создаёт модуль и передаёт себя: ref — модуль-владелец (D-43)', () => {
    const seen: unknown[] = [];
    class Spy extends CompleteTask {
      constructor(deps: Deps, module: typeof MiniModuleDef) {
        super(deps, module);
        seen.push(module, this.ref);
      }
    }
    new ModuleFromDef<typeof MiniModuleDef, Deps, User>(
      MiniModuleDef,
      { ...map, useCases: { completeTask: Spy } },
      deps,
    );
    expect(seen).toEqual([
      MiniModuleDef,
      { kind: 'useCase', module: 'mini', name: 'completeTask' },
    ]);
  });

  test('реализации UC наружу не раздаются', () => {
    // @ts-expect-error useCases — не публичные: вход только через dispatch
    expect(mini.useCases).toBeDefined();
  });
});

describe('ModuleFromDef.dispatch', () => {
  test('команда UC своего модуля — ответ его реализации', async () => {
    const res = await mini.dispatch(
      CompleteTaskUcDef.command({ taskId: TASK }),
      new UserCaller(user),
      REQ,
    );
    expectErr(res, 'TASK_NOT_FOUND');
  });

  test('команда после JSON — UC находится по имени (D-49)', async () => {
    const any: AnyModuleFromDef<User> = mini;
    const wire: Command = JSON.parse(
      JSON.stringify(CompleteTaskUcDef.command({ taskId: TASK })),
    );
    const res = await any.dispatch(wire, new UserCaller(user), REQ);
    expectErr(res, 'TASK_NOT_FOUND');
  });

  test('неизвестный UC — OPERATION_NOT_FOUND с адресом', async () => {
    const any: AnyModuleFromDef<User> = mini;
    const res = await any.dispatch(
      { uc: 'createTask', input: {} },
      new UserCaller(user),
      REQ,
    );
    expect(expectErr(res, 'OPERATION_NOT_FOUND').payload).toEqual({
      module: 'mini',
      uc: 'createTask',
    });
  });

  test('два UC с одним именем в Def модуля — исключение сборки', () => {
    const TwinDef = ModuleDef.define({
      ...MiniModuleDef,
      useCases: [CompleteTaskUcDef, CompleteTaskUcDef],
    });
    // Карту под дубль имени тип не выражает (ключ — имя): проверка рантайма.
    const twinMap = map as never;
    expect(
      () =>
        new ModuleFromDef<typeof TwinDef, Deps, User>(TwinDef, twinMap, deps),
    ).toThrow('Имя UC completeTask повторяется в модуле mini');
  });

  test('команда UC другого модуля — ошибка компиляции', () => {
    const wrong = () =>
      mini.dispatch(
        // @ts-expect-error createTask не из модуля mini
        CreateTaskUcDef.command({ title: 'x' }),
        new UserCaller(user),
        REQ,
      );
    expect(wrong).toBeDefined();
  });
});

describe('ModuleFromDef.runJob', () => {
  test('прогон Job своего модуля со следом вызывающего', async () => {
    const trace = Trace.forJob(ArchiveDoneTasksJobDef);
    expect(expectOk(await mini.runJob(ArchiveDoneTasksJobDef, trace))).toEqual({
      processed: 0,
      failed: 0,
    });
    expect(deps.ran).toEqual([trace]);
  });

  test('Job другого модуля — исключение сборки', async () => {
    const any: AnyModuleFromDef<User> = mini;
    const OtherJobDef = JobDef.define({
      ...ArchiveDoneTasksJobDef,
      name: 'other',
    });
    await expect(
      any.runJob(OtherJobDef, Trace.forJob(OtherJobDef)),
    ).rejects.toThrow('Job other не реализован в модуле mini');
    expect(deps.ran).toEqual([]);
  });
});

describe('ModuleFromDef.subscribe', () => {
  test('реакции подписываются на шину приложения; отписка снимает их', async () => {
    const bus = new MemoryBus();
    deps = {
      app: { ...testAppContext().app, bus },
      facades,
      reacted: [],
      ran: [],
    };
    const off = new ModuleFromDef<typeof MiniModuleDef, Deps, User>(
      MiniModuleDef,
      map,
      deps,
    ).subscribe();
    const removed = {
      ...UserEvents.removed.make({ userId: 'u' }),
      eventId: 'e',
      occurredAt: T0,
      aggregateId: 'u',
      caller: new SystemCaller({ kind: 'job', module: 'users', name: 'test' }),
      cause: { kind: 'request', requestId: 'r-1' },
      correlationId: 'r-1',
    } as const;
    bus.publish(removed);
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.reacted).toEqual(['releaseRemovedUserTasks']);
    off();
    bus.publish(removed);
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.reacted).toEqual(['releaseRemovedUserTasks']);
  });
});

describe('ModuleMap — полнота проверяется компилятором', () => {
  test('пропуск реализации UC', () => {
    const missing: Map = {
      ...map,
      // @ts-expect-error: нет completeTask
      useCases: {},
    };
    expect(missing).toBeDefined();
  });

  test('класс чужого Def под именем UC', () => {
    const wrong: Map = {
      ...map,
      // @ts-expect-error: ReleaseRemoved реализует ER, а не completeTask
      useCases: { completeTask: ReleaseRemoved },
    };
    expect(wrong).toBeDefined();
  });

  test('фасада в карте нет (D-42)', () => {
    // @ts-expect-error: фасад собирает приложение, а не карта модуля
    const extra: Map = { ...map, facade: () => ({}) };
    expect(extra).toBeDefined();
  });

  test('UC, которому нужен субъект богаче, чем даёт приложение', () => {
    // Приложение даёт только uuid, а Policy completeTask спрашивает роли.
    type Poor = { readonly uuid: string };
    const poor: ModuleMap<typeof MiniModuleDef, Deps, Poor> = {
      ...map,
      // @ts-expect-error: Caller<Poor> не несёт hasRole
      useCases: { completeTask: CompleteTask },
    };
    expect(poor).toBeDefined();
  });
});

describe('ModuleFromDef.dispatch — отсев повторов command UC (D-56)', () => {
  const ReplayModuleDef = ModuleDef.define({
    name: 'replayed',
    label: 'Повторы',
    description: 'Модуль для проверки отсева повторов по requestId.',
    dependsOn: [],
    aggregates: [],
    useCases: [CreateTaskUcDef, ListTasksUcDef],
    reactions: [],
    jobs: [],
  });

  type CreateResult = Result<
    OutputOf<typeof CreateTaskUcDef>,
    UseCaseErrorOf<typeof CreateTaskUcDef>
  >;
  type ReplayDeps = ModuleDeps & {
    /** Сколько раз исполнялся каждый UC — UC не исполнен, если счёт тот же. */
    readonly runs: { createTask: number; listTasks: number };
    /** Ответ createTask; тест подменяет его (Err, исключение, ожидание). */
    createTask: () => Promise<CreateResult>;
  };

  /** Счётчик вместо UC: проверяется исполнение, а не логика UC. */
  class CountingCreateTask {
    readonly def = CreateTaskUcDef;
    constructor(private readonly deps: ReplayDeps) {}
    readonly handle = async (): Promise<CreateResult> => {
      this.deps.runs.createTask += 1;
      return this.deps.createTask();
    };
  }

  class CountingListTasks {
    readonly def = ListTasksUcDef;
    constructor(private readonly deps: ReplayDeps) {}
    readonly handle = async () => {
      this.deps.runs.listTasks += 1;
      return ok([]);
    };
  }

  const replayMap = {
    useCases: { createTask: CountingCreateTask, listTasks: CountingListTasks },
    reactions: {},
    jobs: {},
  } satisfies ModuleMap<typeof ReplayModuleDef, ReplayDeps, User>;

  let ctx: ReturnType<typeof testAppContext>;
  let rdeps: ReplayDeps;
  let replayed: ModuleFromDef<typeof ReplayModuleDef, ReplayDeps, User>;

  beforeEach(() => {
    ctx = testAppContext();
    rdeps = {
      app: ctx.app,
      facades,
      runs: { createTask: 0, listTasks: 0 },
      createTask: async () => ok({ taskId: TASK }),
    };
    replayed = new ModuleFromDef<typeof ReplayModuleDef, ReplayDeps, User>(
      ReplayModuleDef,
      replayMap,
      rdeps,
    );
  });

  const owner = new UserCaller(user);
  const create = (title = 'Купить хлеб') => CreateTaskUcDef.command({ title });
  const send = (caller: Caller<User> = owner, trace: Trace = REQ) =>
    replayed.dispatch(create(), caller, trace);

  test('повтор того же входа — сохранённый ответ, UC не исполнен', async () => {
    const first = await send();
    const again = await send();
    expect(expectOk(again)).toEqual({ taskId: TASK });
    expect(again).toEqual(first);
    expect(rdeps.runs.createTask).toBe(1);
  });

  test('тот же вход с другим порядком ключей — тот же вход', async () => {
    const any: AnyModuleFromDef<User> = replayed;
    await any.dispatch(
      { uc: 'createTask', input: { title: 'x', note: 'y' } },
      owner,
      REQ,
    );
    const again = await any.dispatch(
      { uc: 'createTask', input: { note: 'y', title: 'x' } },
      owner,
      REQ,
    );
    expectOk(again);
    expect(rdeps.runs.createTask).toBe(1);
  });

  test('другой вход с тем же requestId — REQUEST_CONFLICT input', async () => {
    await send();
    const res = await replayed.dispatch(create('Другое'), owner, REQ);
    expect(expectErr(res, 'REQUEST_CONFLICT').payload).toEqual({
      requestId: 'r-1',
      reason: 'input',
    });
    expect(rdeps.runs.createTask).toBe(1);
  });

  test('параллельный повтор — REQUEST_CONFLICT in_progress', async () => {
    let finish: (res: CreateResult) => void = () => {};
    rdeps.createTask = () =>
      new Promise<CreateResult>((resolve) => {
        finish = resolve;
      });
    const first = send();
    const again = await send();
    expect(expectErr(again, 'REQUEST_CONFLICT').payload).toEqual({
      requestId: 'r-1',
      reason: 'in_progress',
    });
    finish(ok({ taskId: TASK }));
    expectOk(await first);
    expect(rdeps.runs.createTask).toBe(1);
  });

  test('Err — запись снята, повтор исполняется', async () => {
    rdeps.createTask = async () =>
      CoreErrors.VERSION_CONFLICT.err({ aggregate: 'task', uuid: TASK });
    expectErr(await send(), 'VERSION_CONFLICT');
    rdeps.createTask = async () => ok({ taskId: TASK });
    expectOk(await send());
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('исключение UC — запись снята, исключение наружу, повтор исполняется', async () => {
    rdeps.createTask = async () => {
      throw new Error('сбой');
    };
    await expect(send()).rejects.toThrow('сбой');
    rdeps.createTask = async () => ok({ taskId: TASK });
    expectOk(await send());
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('другой вызывающий с тем же requestId — отдельный ключ', async () => {
    await send();
    await send(new UserCaller({ ...user, uuid: 'u-2' }));
    await send(new DelegateCaller(user, { ...user, uuid: 'u-2' }, 'd-1'));
    await send(new DelegateCaller(user, { ...user, uuid: 'u-3' }, 'd-2'));
    expect(rdeps.runs.createTask).toBe(4);
  });

  test('гость с visitorId — отсев по посетителю', async () => {
    const guest = new GuestCaller<User>();
    const trace = (visitorId: string) =>
      Trace.fromRequest({
        requestId: 'r-1',
        channel: { name: 'telegram', visitorId },
      });
    await send(guest, trace('42'));
    await send(guest, trace('42'));
    await send(guest, trace('43'));
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('без отсева: query', async () => {
    const list = () =>
      replayed.dispatch(ListTasksUcDef.command({}), owner, REQ);
    await list();
    await list();
    expect(rdeps.runs.listTasks).toBe(2);
  });

  test('без отсева: серверный requestId', async () => {
    const generated = Trace.fromRequest({}, () => {});
    await send(owner, generated);
    await send(owner, generated);
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('без отсева: вызывающий system', async () => {
    const system = new SystemCaller<User>(
      { kind: 'useCase', module: 'other', name: 'notify' },
      owner,
    );
    await send(system);
    await send(system);
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('без отсева: гость без visitorId', async () => {
    const guest = new GuestCaller<User>();
    const web = Trace.fromRequest({
      requestId: 'r-2',
      channel: { name: 'web' },
    });
    await send(guest, web);
    await send(guest, web);
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('без отсева: след события', async () => {
    const event = Trace.fromEvent({ eventId: 'e-1', correlationId: 'c-1' });
    await send(owner, event);
    await send(owner, event);
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('гость с тем же visitorId в разных каналах — разные ключи', async () => {
    const guest = new GuestCaller<User>();
    const trace = (name: string) =>
      Trace.fromRequest({
        requestId: 'r-1',
        channel: { name, visitorId: '42' },
      });
    await send(guest, trace('telegram'));
    await send(guest, trace('web'));
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('повтор с сохранённым ответом — info в логгер', async () => {
    await send();
    await send();
    expect(ctx.logs).toEqual([
      {
        level: 'info',
        source: 'replayed.createTask',
        message: 'Повтор запроса r-1: сохранённый ответ',
      },
    ]);
  });

  test('REQUEST_CONFLICT — info в логгер с причиной', async () => {
    await send();
    await replayed.dispatch(create('Другое'), owner, REQ);
    expect(ctx.logs).toEqual([
      {
        level: 'info',
        source: 'replayed.createTask',
        message: 'Повтор запроса r-1 отклонён: input',
      },
    ]);
  });

  test('истёк TTL — команда исполняется снова', async () => {
    await send();
    ctx.setNow(TEST_NOW + DEFAULT_REPLAY_TTL_MS);
    expectOk(await send());
    expect(rdeps.runs.createTask).toBe(2);
  });

  test('сбой claim — SERVER_INTERNAL и error в логгер, UC не исполнен', async () => {
    rdeps = { ...rdeps, app: { ...ctx.app, replay: failingReplay('claim') } };
    replayed = new ModuleFromDef<typeof ReplayModuleDef, ReplayDeps, User>(
      ReplayModuleDef,
      replayMap,
      rdeps,
    );
    expectErr(await send(), 'SERVER_INTERNAL');
    expect(rdeps.runs.createTask).toBe(0);
    expect(ctx.logs.map((r) => r.level)).toEqual(['error']);
  });

  test('сбой complete — Ok как есть и error в логгер', async () => {
    rdeps = {
      ...rdeps,
      app: { ...ctx.app, replay: failingReplay('complete') },
    };
    replayed = new ModuleFromDef<typeof ReplayModuleDef, ReplayDeps, User>(
      ReplayModuleDef,
      replayMap,
      rdeps,
    );
    expectOk(await send());
    expect(ctx.logs.map((r) => r.level)).toEqual(['error']);
  });

  test('сбой release после Err — Err как есть и error в логгер', async () => {
    rdeps = {
      ...rdeps,
      app: { ...ctx.app, replay: failingReplay('release') },
      createTask: async () =>
        CoreErrors.VERSION_CONFLICT.err({ aggregate: 'task', uuid: TASK }),
    };
    replayed = new ModuleFromDef<typeof ReplayModuleDef, ReplayDeps, User>(
      ReplayModuleDef,
      replayMap,
      rdeps,
    );
    expectErr(await send(), 'VERSION_CONFLICT');
    expect(ctx.logs.map((r) => r.level)).toEqual(['error']);
  });

  /** Хранилище, у которого сбоит один метод; остальные — как у пустого. */
  function failingReplay(method: keyof ReplayStore): ReplayStore {
    const store: ReplayStore = {
      claim: async () => ({ kind: 'claimed', token: 't-1' }),
      complete: async () => {},
      release: async () => {},
    };
    return {
      ...store,
      [method]: async () => {
        throw new Error('хранилище недоступно');
      },
    };
  }
});
