import { describe, expect, it } from 'bun:test';
import manifest from '../../../package.json' with { type: 'json' };
import { ExampleAppDef } from '../../testing/example/example.app';
import { ExampleGraph } from '../../testing/example/example.graph';
import { toyProvider } from '../graph.fixture';
import { GRAPH_FORMAT } from '../graph-document';
import { AppGraph } from './app-graph';

describe('AppGraph', () => {
  it('шапка app — имя приложения и переданная версия', () => {
    const json = new AppGraph({ def: ExampleAppDef })
      .document('1.2.3')
      .toJSON();
    expect(json.format).toBe(GRAPH_FORMAT);
    expect(json.app).toEqual({ name: 'example', version: '1.2.3' });
    expect(json.providers.map((p) => [p.name, p.version])).toEqual([
      ['dmg-core', manifest.version],
    ]);
  });

  it('первый узел документа — корень вида app', () => {
    const json = new AppGraph({ def: ExampleAppDef })
      .document('1.0.0')
      .toJSON();
    expect(json.nodes[0]).toMatchObject({ id: 'example', kind: 'app' });
  });

  it('два прогона — одна строка', () => {
    const run = () =>
      new AppGraph({ def: ExampleAppDef }).document('1.0.0').serialize();
    expect(run()).toBe(run());
  });

  it('JSON.parse(serialize()) строго равен toJSON() — undefined в props нет', () => {
    const document = new AppGraph({ def: ExampleAppDef }).document('1.0.0');
    expect(JSON.parse(document.serialize())).toStrictEqual(document.toJSON());
  });

  it('build без providers — в графе один поставщик, dmg-core', () => {
    const graph = new AppGraph({ def: ExampleAppDef }).build();
    expect(graph.providers.map((p) => p.name)).toEqual(['dmg-core']);
  });

  it('дополнительный поставщик из GraphApp.providers попадает в граф', () => {
    const graph = new AppGraph({
      def: ExampleAppDef,
      providers: [toyProvider()],
    }).build();
    expect(graph.providers.map((p) => p.name)).toEqual(['dmg-core', 'toy']);
    expect(graph.node('example')?.provider).toBe('dmg-core');
    expect(graph.node('shop')?.provider).toBe('toy');
  });

  it('visible: true в графе учебного приложения — ровно у семи UC с callers user', () => {
    const json = new AppGraph(ExampleGraph).document('1.0.0').toJSON();
    const visible = json.nodes.filter((n) => n.visible).map((n) => n.id);
    expect(visible.sort()).toEqual([
      'example/todo/assignTask',
      'example/todo/completeTask',
      'example/todo/completeTasks',
      'example/todo/createTask',
      'example/todo/listAssignedTasks',
      'example/todo/listTasks',
      'example/users/getUser',
    ]);
  });
});
