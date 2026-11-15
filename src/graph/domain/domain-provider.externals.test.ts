import { describe, expect, it } from 'bun:test';
import {
  DupAppDef,
  domainGraph,
  edgeKeys,
  OrphanageAppDef,
  PortalAppDef,
} from './domain-provider.fixture';

describe('DomainProvider: внешние ссылки', () => {
  it('базовая ошибка в errors UC — ребро к dmg-core/UNAUTHORIZED', () => {
    const graph = domainGraph(PortalAppDef);
    expect(
      edgeKeys(graph.outgoing('site/portal/publishPage', 'failsWith')),
    ).toEqual([
      'site/portal/publishPage failsWith dmg-core/UNAUTHORIZED',
      'site/portal/publishPage failsWith site/portal/page/PAGE_MISSING',
    ]);
    expect(graph.externals()).toEqual(['dmg-core/UNAUTHORIZED']);
    expect(graph.incoming('dmg-core/UNAUTHORIZED').map((e) => e.from)).toEqual([
      'site/portal/publishPage',
    ]);
  });

  it('рёбра к базовым ошибкам — только для объявленных в errors', () => {
    const graph = domainGraph(PortalAppDef);
    expect(graph.outgoing('site/portal/unlistPage', 'failsWith')).toEqual([]);
  });

  describe('Def вне модулей — сироты', () => {
    const graph = () => domainGraph(OrphanageAppDef);
    const touch = 'orphanage-app/orphanage/touchStray';
    const watch = 'orphanage-app/orphanage/watchStray';

    it('сборка не падает, сироты — внешние id', () => {
      expect(graph().externals()).toEqual([
        'dmg-core/orphan/aggregate/stray',
        'dmg-core/orphan/domainRule/strayCheck',
        'dmg-core/orphan/error/STRAY_GONE',
        'dmg-core/orphan/event/lost.stray.happened',
        'dmg-core/orphan/useCase/strayQuery',
      ]);
    });

    it.each([
      ['агрегат', touch, 'touches', 'dmg-core/orphan/aggregate/stray'],
      ['UC', touch, 'calls', 'dmg-core/orphan/useCase/strayQuery'],
      ['событие', touch, 'emits', 'dmg-core/orphan/event/lost.stray.happened'],
      ['ошибка', touch, 'failsWith', 'dmg-core/orphan/error/STRAY_GONE'],
      ['правило', touch, 'checks', 'dmg-core/orphan/domainRule/strayCheck'],
      [
        'подписка на событие',
        watch,
        'subscribes',
        'dmg-core/orphan/event/lost.stray.happened',
      ],
    ])('%s вне модулей — ребро %s → сирота', (_what, from, kind, to) => {
      expect(edgeKeys(graph().outgoing(from, kind))).toEqual([
        `${from} ${kind} ${to}`,
      ]);
    });

    it('сирота — не узел: текстов Def вне модулей в графе нет', () => {
      for (const id of graph().externals())
        expect(graph().node(id)).toBeUndefined();
      expect(
        graph()
          .nodes()
          .filter((n) => n.kind === 'domainRule'),
      ).toEqual([]);
    });

    it('у правила вне модулей нет ребра failsWith', () => {
      expect(
        graph()
          .edges()
          .filter((e) => e.kind === 'failsWith')
          .map((e) => e.to),
      ).toEqual(['dmg-core/orphan/error/STRAY_GONE']);
    });
  });

  describe('повтор ссылки в Def', () => {
    it('правило дважды в rules — сборка не падает, узел и ребро одни', () => {
      const graph = domainGraph(DupAppDef);
      const rule = 'dup-app/dup/entry/unique';
      expect(graph.node(rule)?.kind).toBe('domainRule');
      expect(graph.nodes().filter((n) => n.kind === 'domainRule')).toHaveLength(
        1,
      );
      expect(
        edgeKeys(graph.outgoing('dup-app/dup/addEntry', 'checks')),
      ).toEqual([`dup-app/dup/addEntry checks ${rule}`]);
    });
  });
});
