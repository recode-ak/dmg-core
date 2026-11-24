import {
  DomainIds,
  type GraphContribution,
  type GraphKinds,
  type GraphNodeInput,
  type GraphProvider,
  type GraphRule,
  type SourceLayer,
} from '#core/graph/index';
import type { AnyAppDef } from '#core/index';
import type { AnyScreenDef } from './screen-def.types';
import { SCREEN_KINDS, SCREEN_PROVIDER, SCREEN_ROOT } from './screen-kinds';
import { ScreenWithoutUcRule } from './screen-rule';

/**
 * Поставщик «экран»: корень `example-ui`, узел на экран, рёбра `uses` к UC и
 * `listens` к событиям. Ссылки на домен — только через `DomainIds`.
 */
export class ScreenProvider implements GraphProvider {
  readonly name = SCREEN_PROVIDER;
  readonly version = '1.0.0';

  constructor(
    readonly app: AnyAppDef,
    readonly screens: readonly AnyScreenDef[],
  ) {}

  kinds(): GraphKinds {
    return SCREEN_KINDS;
  }

  contribute(): GraphContribution {
    const ids = new DomainIds(this.app);
    return {
      nodes: [
        ScreenProvider.rootNode(),
        ...this.screens.map(ScreenProvider.node),
      ],
      edges: this.screens.flatMap((screen) => {
        const from = ScreenProvider.id(screen);
        return [
          ...screen.uses.map((uc) => ({
            kind: 'uses',
            from,
            to: ids.operation(uc),
          })),
          ...screen.listens.map((e) => ({
            kind: 'listens',
            from,
            to: ids.event(e),
          })),
        ];
      }),
    };
  }

  rules(): readonly GraphRule[] {
    return [new ScreenWithoutUcRule()];
  }

  /** Слой `screen` (D-107): на оси раннеров, видит сборку, kernel и вход домена. */
  layers(): readonly SourceLayer[] {
    return [
      {
        name: 'screen',
        axis: 'runner',
        rule: 'SCR-02',
        sees: [
          { layer: 'assembly' },
          { layer: 'kernel' },
          { layer: 'domain', entries: ['public'] },
        ],
      },
    ];
  }

  private static id(screen: AnyScreenDef): string {
    return `${SCREEN_ROOT}/${screen.name}`;
  }

  private static rootNode(): GraphNodeInput {
    return {
      kind: 'uiApp',
      id: SCREEN_ROOT,
      label: 'Приложение UI',
      description: 'Экраны учебного приложения; не часть доменного приложения.',
      visible: false,
      props: {},
    };
  }

  private static node(screen: AnyScreenDef): GraphNodeInput {
    const { label, description, visible } = screen;
    return {
      kind: 'screen',
      id: ScreenProvider.id(screen),
      label,
      description,
      visible,
      props: {},
    };
  }
}
