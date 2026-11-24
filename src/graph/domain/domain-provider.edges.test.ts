import { describe, expect, it } from 'bun:test';
import { ExampleAppDef } from '../../testing/example/platform/domain/example.app';
import type { Graph } from '../graph';
import {
  CartAppDef,
  domainGraph,
  edgeKeys,
  NotesAppDef,
} from './domain-provider.fixture';

describe('DomainProvider: рёбра', () => {
  const example = () => domainGraph(ExampleAppDef);
  const notes = () => domainGraph(NotesAppDef);

  /** Источники входящих рёбер `kind` узла `to`, оставшиеся вида `sourceKind`. */
  const sources = (
    graph: Graph,
    to: string,
    kind: string,
    sourceKind: string,
  ) =>
    graph
      .incoming(to, kind)
      .filter((e) => graph.node(e.from)?.kind === sourceKind)
      .map((e) => e.from);

  it('UC → агрегат: touches; обратная — входящие агрегата', () => {
    expect(
      edgeKeys(example().outgoing('example/todo/createTask', 'touches')),
    ).toEqual(['example/todo/createTask touches example/todo/task']);
    // вхождение, а не равенство: срезы-примеры расширяют учебный модуль
    expect(
      sources(example(), 'example/todo/task', 'touches', 'useCase'),
    ).toEqual(
      expect.arrayContaining([
        'example/todo/createTask',
        'example/todo/completeTask',
        'example/todo/listTasks',
        'example/todo/getTask',
        'example/todo/assignTask',
      ]),
    );
  });

  it('операции → UC: calls; обратная — входящие calls', () => {
    expect(
      edgeKeys(notes().outgoing('notes-app/notes/showTask', 'calls')),
    ).toEqual(['notes-app/notes/showTask calls notes-app/todo/getTask']);
    expect(
      edgeKeys(notes().outgoing('notes-app/notes/notifyTodo', 'calls')),
    ).toEqual([
      'notes-app/notes/notifyTodo calls notes-app/todo/completeTask',
      'notes-app/notes/notifyTodo calls notes-app/todo/getTask',
    ]);
    expect(
      edgeKeys(notes().outgoing('notes-app/notes/sweep', 'calls')),
    ).toEqual(['notes-app/notes/sweep calls notes-app/todo/getTask']);
    expect(
      notes()
        .incoming('notes-app/todo/getTask', 'calls')
        .map((e) => e.from),
    ).toEqual([
      'notes-app/notes/notifyTodo',
      'notes-app/notes/showTask',
      'notes-app/notes/sweep',
    ]);
    expect(
      notes()
        .incoming('notes-app/todo/completeTask', 'calls')
        .map((e) => e.from),
    ).toEqual(['notes-app/notes/notifyTodo']);
    expect(example().incoming('example/todo/createTask', 'calls')).toEqual([]);
  });

  it('ER и Job → агрегат: touches; обратные — по виду источника', () => {
    expect(
      edgeKeys(
        example().outgoing('example/todo/releaseRemovedUserTasks', 'touches'),
      ),
    ).toEqual([
      'example/todo/releaseRemovedUserTasks touches example/todo/task',
    ]);
    expect(
      edgeKeys(example().outgoing('example/todo/archiveDoneTasks', 'touches')),
    ).toEqual(['example/todo/archiveDoneTasks touches example/todo/task']);
    expect(
      sources(example(), 'example/todo/task', 'touches', 'eventReaction'),
    ).toEqual(['example/todo/releaseRemovedUserTasks']);
    expect(sources(example(), 'example/todo/task', 'touches', 'job')).toEqual([
      'example/todo/archiveDoneTasks',
    ]);
  });

  it('событие: родитель — агрегат; входящие emits и subscribes', () => {
    expect(example().node('example/todo/task/archived')?.parent).toBe(
      'example/todo/task',
    );
    expect(
      example()
        .incoming('example/todo/task/archived', 'emits')
        .map((e) => e.from),
    ).toEqual([
      'example/todo/archiveDoneTasks',
      'example/todo/releaseRemovedUserTasks',
    ]);
    expect(
      example().incoming('example/todo/task/archived', 'subscribes'),
    ).toEqual([]);
    expect(example().node('example/users/user/removed')?.parent).toBe(
      'example/users/user',
    );
    expect(
      edgeKeys(example().incoming('example/users/user/removed', 'subscribes')),
    ).toEqual([
      'example/todo/releaseRemovedUserTasks subscribes example/users/user/removed',
    ]);
  });

  it('ошибка: родитель — агрегат; входящие failsWith; вид ошибки в props', () => {
    const id = 'example/todo/task/TASK_NOT_FOUND';
    expect(example().node(id)?.parent).toBe('example/todo/task');
    expect(example().node(id)?.props.kind).toBe('not_found');
    expect(example().node('example/todo/task/TASK_ARCHIVED')?.props.kind).toBe(
      'conflict',
    );
    expect(sources(example(), id, 'failsWith', 'useCase')).toEqual(
      expect.arrayContaining([
        'example/todo/assignTask',
        'example/todo/completeTask',
        'example/todo/getTask',
      ]),
    );
  });

  it('UC → правило: checks; правило → ошибка: failsWith', () => {
    const rule = 'example/todo/task/withinOpenLimit';
    expect(
      edgeKeys(example().outgoing('example/todo/createTask', 'checks')),
    ).toEqual([`example/todo/createTask checks ${rule}`]);
    expect(example().outgoing('example/todo/completeTask', 'checks')).toEqual(
      [],
    );
    expect(edgeKeys(example().outgoing(rule, 'failsWith'))).toEqual([
      `${rule} failsWith example/todo/task/TASK_TOO_MANY_OPEN`,
    ]);
    expect(
      example()
        .incoming(rule, 'checks')
        .map((e) => e.from),
    ).toEqual(['example/todo/createTask']);
  });

  it('правило чужого модуля: один узел у владельца ошибки, checks от UC обоих модулей', () => {
    const cart = domainGraph(CartAppDef);
    const rule = 'cart-app/shop/item/unique';
    expect(cart.ancestors(rule).find((n) => n.kind === 'module')?.id).toBe(
      'cart-app/shop',
    );
    expect(cart.incoming(rule, 'checks').map((e) => e.from)).toEqual([
      'cart-app/cart/addLine',
      'cart-app/shop/createItem',
    ]);
  });

  it('ошибки UC — исходящие failsWith в порядке id ошибки', () => {
    expect(
      edgeKeys(example().outgoing('example/todo/completeTask', 'failsWith')),
    ).toEqual([
      'example/todo/completeTask failsWith example/todo/task/TASK_ALREADY_DONE',
      'example/todo/completeTask failsWith example/todo/task/TASK_ARCHIVED',
      'example/todo/completeTask failsWith example/todo/task/TASK_NOT_FOUND',
    ]);
  });

  it('UC публикует событие: emits к событию агрегата', () => {
    expect(
      edgeKeys(notes().outgoing('notes-app/notes/addNote', 'emits')),
    ).toEqual(['notes-app/notes/addNote emits notes-app/notes/note/added']);
  });

  it('подписка: ER → событие своего модуля — subscribes', () => {
    expect(
      edgeKeys(notes().outgoing('notes-app/notes/indexNote', 'subscribes')),
    ).toEqual([
      'notes-app/notes/indexNote subscribes notes-app/notes/note/added',
    ]);
  });
});
