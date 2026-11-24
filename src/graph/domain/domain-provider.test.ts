import { describe, expect, it } from 'bun:test';
import manifest from '../../../package.json' with { type: 'json' };
import { ExampleAppDef } from '../../testing/example/platform/domain/example.app';
import { DomainProvider } from './domain-provider';
import {
  CartAppDef,
  domainGraph,
  LegacyAppDef,
  NotesAppDef,
  PortalAppDef,
  ScaledAppDef,
  ShopAppDef,
  TodoOnlyAppDef,
} from './domain-provider.fixture';

const ids = (nodes: readonly { id: string }[]) => nodes.map((n) => n.id);

describe('DomainProvider: корень и поставщик', () => {
  it('корень один — узел app с id имени приложения', () => {
    const graph = domainGraph(ExampleAppDef);
    expect(ids(graph.roots())).toEqual(['example']);
    const root = graph.node('example');
    expect(root?.kind).toBe('app');
    expect(root?.label).toBe(ExampleAppDef.label);
    expect(root?.description).toBe(ExampleAppDef.description);
  });

  it('scale приложения — в props узла app', () => {
    expect(domainGraph(ScaledAppDef).node('scaled')?.props).toEqual({
      scale: 'school',
    });
  });

  it('без scale ключа в props узла app нет', () => {
    const props = domainGraph(ExampleAppDef).node('example')?.props;
    expect(Object.keys(props ?? { scale: 'есть' })).toEqual([]);
  });

  it('поставщик — dmg-core с версией пакета', () => {
    const provider = new DomainProvider(ExampleAppDef);
    expect(provider.name).toBe('dmg-core');
    expect(provider.version).toBe(manifest.version);
  });

  it('у каждого узла и ребра provider — dmg-core', () => {
    const graph = domainGraph(NotesAppDef);
    expect(graph.nodes().length).toBeGreaterThan(0);
    expect(graph.edges().length).toBeGreaterThan(0);
    expect(new Set(graph.nodes().map((n) => n.provider))).toEqual(
      new Set(['dmg-core']),
    );
    expect(new Set(graph.edges().map((e) => e.provider))).toEqual(
      new Set(['dmg-core']),
    );
  });

  it('виды поставщика — девять узлов и семь рёбер', () => {
    const kinds = new DomainProvider(ExampleAppDef).kinds();
    expect(kinds.nodes.map((k) => k.kind).sort()).toEqual([
      'aggregate',
      'app',
      'domainRule',
      'error',
      'event',
      'eventReaction',
      'job',
      'module',
      'useCase',
    ]);
    expect(kinds.edges.map((k) => k.kind).sort()).toEqual([
      'calls',
      'checks',
      'dependsOn',
      'emits',
      'failsWith',
      'subscribes',
      'touches',
    ]);
  });
});

describe('DomainProvider: состав', () => {
  it('модули — дети корня: замыкание состава по dependsOn', () => {
    const graph = domainGraph(TodoOnlyAppDef);
    expect(ids(graph.children('todo-only'))).toEqual([
      'todo-only/todo',
      'todo-only/users',
    ]);
    expect(graph.node('todo-only/todo')?.kind).toBe('module');
    expect(
      graph
        .outgoing('todo-only/todo', 'dependsOn')
        .map((e) => `${e.from} ${e.kind} ${e.to}`),
    ).toEqual(['todo-only/todo dependsOn todo-only/users']);
  });

  it('узел правила — под агрегатом-владельцем ошибки', () => {
    const graph = domainGraph(ExampleAppDef);
    const rule = graph.node('example/todo/task/withinOpenLimit');
    expect(rule).toMatchObject({
      kind: 'domainRule',
      label: 'Открытых задач меньше предела',
      parent: 'example/todo/task',
      props: {},
    });
    expect(rule?.description).toContain('меньше 3 открытых задач');
  });

  it('правила с одним name у двух агрегатов — два узла', () => {
    const graph = domainGraph(ShopAppDef);
    const rules = graph.nodes().filter((n) => n.kind === 'domainRule');
    expect(ids(rules)).toEqual([
      'shop-app/shop/item/unique',
      'shop-app/shop/order/unique',
    ]);
    expect(rules.map((n) => n.parent)).toEqual([
      'shop-app/shop/item',
      'shop-app/shop/order',
    ]);
    const checkedBy = (rule: string) =>
      graph.incoming(rule, 'checks').map((e) => e.from);
    expect(checkedBy('shop-app/shop/item/unique')).toEqual([
      'shop-app/shop/createItem',
    ]);
    expect(checkedBy('shop-app/shop/order/unique')).toEqual([
      'shop-app/shop/createOrder',
    ]);
  });

  it('внешний модуль из dependsOn — узел приложения с external: true', () => {
    const graph = domainGraph(LegacyAppDef);
    expect(graph.node('legacy-app/vendor')).toMatchObject({
      kind: 'module',
      parent: 'legacy-app',
      props: { external: true },
    });
    expect(graph.node('legacy-app/legacy')?.props).toEqual({ external: false });
    expect(graph.node('legacy-app/vendor/part')?.kind).toBe('aggregate');
  });

  it('правило чужого модуля — один узел у владельца ошибки', () => {
    const graph = domainGraph(CartAppDef);
    const rules = graph.nodes().filter((n) => n.kind === 'domainRule');
    expect(ids(rules)).toEqual([
      'cart-app/shop/item/unique',
      'cart-app/shop/order/unique',
    ]);
    expect(graph.node('cart-app/cart/line/unique')).toBeUndefined();
  });
});

describe('DomainProvider: признаки Def', () => {
  const graph = () => domainGraph(PortalAppDef);

  it('visible Def — в поле узла, остальные — false', () => {
    expect(
      ids(
        graph()
          .nodes()
          .filter((n) => n.visible),
      ),
    ).toEqual([
      'site',
      'site/portal',
      'site/portal/page',
      'site/portal/page/PAGE_MISSING',
      'site/portal/page/published',
      'site/portal/publishPage',
    ]);
    expect(graph().node('site/portal/unlistPage')?.visible).toBe(false);
  });

  it('exposed — в props UC и события', () => {
    expect(graph().node('site/portal/publishPage')?.props.exposed).toBe(true);
    expect(graph().node('site/portal/unlistPage')?.props.exposed).toBe(false);
    expect(graph().node('site/portal/page/published')?.props.exposed).toBe(
      true,
    );
  });
});

describe('DomainProvider: свойства узлов', () => {
  const cases: readonly [string, string, string[]][] = [
    ['app', 'scaled', ['scale']],
    ['module', 'example/todo', ['external']],
    ['aggregate', 'example/todo/task', ['state', 'statuses', 'transitions']],
    [
      'useCase',
      'example/todo/createTask',
      ['exposed', 'type', 'callers', 'personal', 'policy', 'input', 'output'],
    ],
    ['eventReaction', 'example/todo/releaseRemovedUserTasks', []],
    ['job', 'example/todo/archiveDoneTasks', ['schedule']],
    ['event', 'example/todo/task/created', ['name', 'exposed', 'payload']],
    ['error', 'example/todo/task/TASK_NOT_FOUND', ['kind', 'payload']],
    ['domainRule', 'example/todo/task/withinOpenLimit', []],
  ];

  it.each(cases)('вид %s — ключи props узла %s', (kind, id, keys) => {
    const app = kind === 'app' ? ScaledAppDef : ExampleAppDef;
    const node = domainGraph(app).node(id);
    expect(node?.kind).toBe(kind);
    expect(Object.keys(node?.props ?? { нет: 'узла' })).toEqual(keys);
  });

  it('ошибка без payload — в props только kind', () => {
    const node = domainGraph(ExampleAppDef).node(
      'example/todo/task/TASK_ARCHIVED',
    );
    expect(node?.props).toEqual({ kind: 'conflict' });
  });

  it('событие: name — полное имя, не сегмент id', () => {
    const node = domainGraph(ExampleAppDef).node('example/todo/task/created');
    expect(node?.props.name).toBe('todo.task.created');
  });

  it('агрегат: statuses и transitions в props, ошибки — дети', () => {
    const graph = domainGraph(ExampleAppDef);
    const task = graph.node('example/todo/task');
    const props = task?.props as {
      statuses: Record<string, unknown>;
      transitions: Record<string, unknown>;
    };
    expect(Object.keys(props.statuses)).toEqual(['open', 'done', 'archived']);
    expect(props.transitions.complete).toEqual({
      from: ['open'],
      to: 'done',
      rejects: { done: 'TASK_ALREADY_DONE', archived: 'TASK_ARCHIVED' },
    });
    expect(ids(graph.children('example/todo/task'))).toContain(
      'example/todo/task/TASK_ALREADY_DONE',
    );
  });

  it('модуль узла читается по ancestors', () => {
    const graph = domainGraph(ExampleAppDef);
    const ancestors = graph.ancestors('example/todo/listTasks');
    expect(ancestors.find((n) => n.kind === 'module')?.id).toBe('example/todo');
    expect(graph.node('example/todo/listTasks')?.props.type).toBe('query');
  });
});
