import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Trace } from '#core/app/index';
import { ArchChecker, reportArchCheck } from '#core/arch/index';
import { AppGraph } from '#core/graph/index';
import { SystemCaller, UserCaller } from '#core/index';
import { AwaitingBus, expectOk, MemoryLogger } from '#core/testing/index';
import { ExampleApp } from '../app/example-app';
import { ExampleAppDef } from '../example.app';
import type { ExampleUser } from '../shared/app-user';
import {
  CompleteTaskUcDef,
  CreateTaskUcDef,
  TaskEvents,
  TodoModuleDef,
} from '../todo/contract';
import { ScreenArch } from './screen.arch';
import { ScreenGraph } from './screen.graph';
import { ScreenDef } from './screen-def';
import { SCREEN_PROVIDER } from './screen-kinds';
import { ScreenProvider } from './screen-provider';
import { ScreenSession } from './screen-session';
import { TasksScreenDef } from './tasks.screen';
import { TasksScreen } from './tasks-screen';

// Приёмочный тест расширения-образца «экран» (D-92…D-99): вид Def, поставщик
// графа, правило SCR-01, сессия экрана. Данные — во временном каталоге, порты
// подменены (`AwaitingBus`, `MemoryLogger`, часы).

const OWNER = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const T0 = Date.UTC(2026, 9, 1);

const AboutScreenDef = ScreenDef.define({
  name: 'about',
  label: 'О программе',
  description: 'Справка о приложении; ни одного UC не вызывает.',
  visible: true,
  uses: [],
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'screen-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeApp() {
  const bus = new AwaitingBus();
  const logger = new MemoryLogger();
  const example = new ExampleApp(
    { mode: 'test', dataDir: dir, users: [OWNER] },
    { bus, logger, clock: () => T0 },
  );
  const session = new ScreenSession(
    TasksScreenDef,
    { bus, logger },
    example.api,
  );
  return { example, bus, logger, session };
}

describe('экран: вид Def', () => {
  it('normalize даёт форму экрана: ссылки — именами', () => {
    expect(TasksScreenDef.normalize()).toEqual({
      dmg: 'screen',
      name: 'tasks',
      label: 'Мои задачи',
      description:
        'Список задач пользователя; обновляется, когда задача создана.',
      visible: true,
      uses: ['listTasks', 'createTask'],
      listens: ['todo.task.created'],
    });
  });
});

describe('экран: граф', () => {
  it('узел и рёбра экрана — от своего поставщика под корнем example-ui', () => {
    const graph = new AppGraph(ScreenGraph).build();

    expect(graph.node('example-ui/tasks')).toEqual({
      id: 'example-ui/tasks',
      kind: 'screen',
      label: 'Мои задачи',
      description:
        'Список задач пользователя; обновляется, когда задача создана.',
      visible: true,
      parent: 'example-ui',
      provider: SCREEN_PROVIDER,
      props: {},
    });
    const uses = graph.outgoing('example-ui/tasks', 'uses');
    expect(uses.map((e) => e.to)).toEqual([
      'example/todo/createTask',
      'example/todo/listTasks',
    ]);
    expect(uses.map((e) => e.provider)).toEqual([
      'example-screen',
      'example-screen',
    ]);
    expect(
      graph.outgoing('example-ui/tasks', 'listens').map((e) => e.to),
    ).toEqual(['example/todo/task/created']);
    const provider = graph.providers.find((p) => p.name === 'example-screen');
    expect(provider?.nodeKinds.map((k) => k.kind)).toEqual(['screen', 'uiApp']);
    expect(provider?.edgeKinds.map((k) => k.kind)).toEqual(['listens', 'uses']);
    expect(graph.externals()).toEqual([]);
  });

  it('документ графа детерминирован и каждый элемент — от поставщика', () => {
    const first = new AppGraph(ScreenGraph).document('1.0.0');
    const again = new AppGraph({
      ...ScreenGraph,
      providers: [new ScreenProvider(ExampleAppDef, [TasksScreenDef])],
    }).document('1.0.0');

    expect(again.serialize()).toBe(first.serialize());
    const json = first.toJSON();
    expect(json.providers.map((p) => p.name)).toEqual([
      'dmg-core',
      'example-screen',
    ]);
    expect(json.nodes.filter((n) => !n.provider)).toEqual([]);
    expect(json.edges.filter((e) => !e.provider)).toEqual([]);
  });
});

describe('экран: проверки архитектуры', () => {
  it('образец не нарушает правил', () => {
    expect(ArchChecker.of(ScreenArch).check()).toEqual([]);
  });

  it('экран без UC попадает в отчёт: код 1 и SCR-01', () => {
    const lines: string[] = [];

    const code = reportArchCheck(
      [
        {
          ...ScreenArch,
          providers: [
            new ScreenProvider(ExampleAppDef, [TasksScreenDef, AboutScreenDef]),
          ],
        },
      ],
      (line) => {
        lines.push(line);
      },
    );

    expect(code).toBe(1);
    expect(lines).toContain(
      'SCR-01: экран example-ui/about не вызывает ни одного UC',
    );
  });
});

describe('экран: сессия', () => {
  it('подписка вызывает UC, цепочка видна в логе операций', async () => {
    const { example, bus, logger, session } = makeApp();
    const screen = new TasksScreen(session, example.callers);
    screen.open();
    const caller = expectOk(
      await example.callers.resolve(
        OWNER,
        Trace.fromRequest({ requestId: 'r' }),
      ),
    );
    if (!(caller instanceof UserCaller)) throw new Error('не пользователь');
    const requestId = crypto.randomUUID();

    const { taskId } = expectOk(
      await example.api.dispatch(
        TodoModuleDef,
        CreateTaskUcDef.command({ title: 'Хлеб' }),
        caller,
        Trace.fromRequest({ requestId }),
      ),
    );
    await bus.delivered();

    expect(screen.items()).toEqual([
      { uuid: taskId, title: 'Хлеб', status: 'open' },
    ]);
    const [created] = bus.published.filter(
      (e) => e.name === TaskEvents.created.name,
    );
    const traces = readFileSync(join(dir, 'oplog', '2026-10-01.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((record) => record.op === 'listTasks')
      .map((record) => record.trace);
    expect(traces).toEqual([
      {
        cause: { kind: 'event', eventId: created?.eventId },
        correlationId: requestId,
      },
    ]);
    expect(logger.records).toEqual([]);
  });

  it('вызов необъявленного UC — отказ до вызова', () => {
    const { session } = makeApp();
    const admin = new SystemCaller<ExampleUser>({
      kind: 'useCase',
      module: 'admin',
      name: 'purge',
    });

    expect(() =>
      session.dispatch(
        TodoModuleDef,
        CompleteTaskUcDef,
        { taskId: crypto.randomUUID() },
        admin,
        Trace.fromRequest({ requestId: crypto.randomUUID() }),
      ),
    ).toThrow('экран tasks не объявил UC completeTask');
  });

  it('подписка на необъявленное событие — отказ', () => {
    const { session } = makeApp();

    expect(() =>
      session.on(TaskEvents.completed, async () => undefined),
    ).toThrow('экран tasks не объявил событие todo.task.completed');
  });
});
