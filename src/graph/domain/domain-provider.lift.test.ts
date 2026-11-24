import { describe, expect, it } from 'bun:test';
import { ExampleAppDef } from '../../testing/example/platform/domain/example.app';
import {
  CartAppDef,
  domainGraph,
  edgeKeys,
  NotesAppDef,
} from './domain-provider.fixture';

describe('DomainProvider: связи модулей подъёмом', () => {
  const link = (l: { kind: string; from: string; to: string }) =>
    `${l.from} ${l.kind} ${l.to}`;

  it('связи модулей учебного приложения', () => {
    const lifted = domainGraph(ExampleAppDef).liftToKind('module');
    expect(lifted.map(link)).toEqual([
      'example/todo calls example/users',
      'example/todo dependsOn example/users',
      'example/todo failsWith example/users',
      'example/todo subscribes example/users',
    ]);
  });

  it('вызов между модулями: запись на пару модулей, sources — операция → UC', () => {
    const lifted = domainGraph(NotesAppDef).liftToKind('module');
    const calls = lifted.filter((l) => l.kind === 'calls');
    expect(calls.map(link)).toEqual([
      'notes-app/notes calls notes-app/todo',
      'notes-app/todo calls notes-app/users',
    ]);
    expect(edgeKeys(calls[0]?.sources ?? [])).toEqual([
      'notes-app/notes/notifyTodo calls notes-app/todo/completeTask',
      'notes-app/notes/notifyTodo calls notes-app/todo/getTask',
      'notes-app/notes/showTask calls notes-app/todo/getTask',
      'notes-app/notes/sweep calls notes-app/todo/getTask',
    ]);
    expect(edgeKeys(calls[1]?.sources ?? [])).toEqual([
      'notes-app/todo/assignTask calls notes-app/users/getUser',
    ]);
  });

  it('тип цели вызова — свойство узла-цели', () => {
    const graph = domainGraph(NotesAppDef);
    expect(graph.node('notes-app/todo/getTask')?.props.type).toBe('query');
    expect(graph.node('notes-app/todo/completeTask')?.props.type).toBe(
      'command',
    );
  });

  it('подписка и публикация внутри модуля связи не дают', () => {
    const graph = domainGraph(NotesAppDef);
    const lifted = graph.liftToKind('module');
    // подписка indexNote и публикация addNote — на событие своего модуля
    expect(
      graph.outgoing('notes-app/notes/indexNote', 'subscribes'),
    ).toHaveLength(1);
    expect(lifted.filter((l) => l.kind === 'subscribes').map(link)).toEqual([
      'notes-app/notes subscribes notes-app/todo',
      'notes-app/todo subscribes notes-app/users',
    ]);
    expect(lifted.filter((l) => l.kind === 'emits')).toEqual([]);
    expect(lifted.filter((l) => l.from === l.to)).toEqual([]);
  });

  it('подписка между модулями — от модуля реакции к модулю события', () => {
    const subscribes = domainGraph(NotesAppDef)
      .liftToKind('module')
      .filter((l) => l.kind === 'subscribes');
    expect(edgeKeys(subscribes[0]?.sources ?? [])).toEqual([
      'notes-app/notes/notifyTodo subscribes notes-app/todo/task/created',
    ]);
  });

  it('правило чужого модуля — checks и failsWith от cart к shop', () => {
    const lifted = domainGraph(CartAppDef).liftToKind('module');
    expect(lifted.map(link)).toEqual([
      'cart-app/cart checks cart-app/shop',
      'cart-app/cart dependsOn cart-app/shop',
      'cart-app/cart failsWith cart-app/shop',
    ]);
  });
});
