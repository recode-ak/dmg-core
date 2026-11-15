import type { Graph } from '../graph';
import { GraphBuilder } from '../graph-builder';
import { GraphDocument } from '../graph-document';
import { DomainProvider } from './domain-provider';
import type { GraphApp } from './graph-app.types';

/** Граф приложения (D-95): поставщик домена плюс поставщики из `GraphApp`. */
export class AppGraph {
  constructor(private readonly app: GraphApp) {}

  build(): Graph {
    const builder = new GraphBuilder().add(new DomainProvider(this.app.def));
    for (const provider of this.app.providers ?? []) builder.add(provider);
    return builder.build();
  }

  /** Документ формата 1; шапка `app` — имя `AppDef` и переданная версия. */
  document(version: string): GraphDocument {
    return GraphDocument.of(this.build(), {
      app: { name: this.app.def.name, version },
    });
  }
}
