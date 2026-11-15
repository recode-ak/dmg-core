// Чистая пара модулей для контрактных проверок: `alpha` зависит от `beta`,
// слушает его событие и вызывает его UC через фасад (`calls`). Негативные
// фикстуры — в тестах, как варианты этих Def. Внизу — игрушечные поставщики
// графа с правилами (D-97).
import * as v from 'valibot';
import { AggregateDef } from '../domain/aggregate/aggregate-def';
import { EventReactionDef } from '../domain/contracts/event-reaction-def';
import { JobDef } from '../domain/contracts/job-def';
import { ModuleDef } from '../domain/contracts/module-def';
import { UseCaseDef } from '../domain/contracts/use-case-def';
import { EventDef } from '../domain/events/event-def';
import { allowAll } from '../domain/policy/rule';
import type { Graph } from '../graph/graph';
import type { GraphNodeInput } from '../graph/graph.types';
import type { GraphContribution, GraphProvider } from '../graph/graph-provider';
import type { GraphRule } from '../graph/graph-rule.types';
import type { GraphKinds } from '../graph/kind-registry.types';
import { ErrorDef } from '../kernel/errors/error-def';
import { BaseEntityFields, F } from '../kernel/fields/fields';

export const ItemEvents = EventDef.define('beta.item', {
  created: {
    label: 'Позиция создана',
    description: 'Появилась новая позиция.',
    payload: v.object({ itemId: F.uuid('позиции') }),
  },
});

export const ItemErrors = ErrorDef.define('ITEM', {
  NOT_FOUND: {
    kind: 'not_found',
    label: 'Позиция не найдена',
    description: 'Позиции с таким идентификатором нет.',
    payload: v.object({ itemId: F.uuid('позиции') }),
  },
});

export const ItemArDef = AggregateDef.define({
  name: 'item',
  label: 'Позиция',
  description: 'Позиция каталога.',
  state: v.object({ ...BaseEntityFields, title: F.string('Название') }),
  events: ItemEvents,
  errors: ItemErrors,
});

export const CreateItemUcDef = UseCaseDef.define({
  name: 'createItem',
  label: 'Создать позицию',
  description: 'Добавляет позицию в каталог.',
  type: 'command',
  aggregate: ItemArDef,
  callers: ['user'],
  policy: allowAll,
  input: v.object({ title: F.string('Название') }),
  output: v.object({ itemId: F.uuid('позиции') }),
  errors: [],
  emits: [ItemEvents.created],
});

export const GetItemUcDef = UseCaseDef.define({
  name: 'getItem',
  label: 'Позиция',
  description: 'Позиция по идентификатору — для других модулей.',
  type: 'query',
  aggregate: ItemArDef,
  callers: ['system'],
  policy: allowAll,
  input: v.object({ itemId: F.uuid('позиции') }),
  output: v.object({ title: F.string('Название') }),
  errors: [ItemErrors.NOT_FOUND],
});

export const BetaModuleDef = ModuleDef.define({
  name: 'beta',
  label: 'Каталог',
  description: 'Модуль-зависимость.',
  dependsOn: [],
  aggregates: [ItemArDef],
  useCases: [CreateItemUcDef, GetItemUcDef],
  reactions: [],
  jobs: [],
});

export const NoteEvents = EventDef.define('alpha.note', {
  added: {
    label: 'Заметка добавлена',
    description: 'К позиции добавлена заметка.',
    payload: v.object({ noteId: F.uuid('заметки') }),
  },
});

export const NoteErrors = ErrorDef.define('NOTE', {
  EMPTY: {
    kind: 'validation',
    label: 'Пустая заметка',
    description: 'Текст заметки пуст.',
  },
});

export const NoteArDef = AggregateDef.define({
  name: 'note',
  label: 'Заметка',
  description: 'Заметка к позиции.',
  state: v.object({ ...BaseEntityFields, text: F.string('Текст') }),
  events: NoteEvents,
  errors: NoteErrors,
});

export const AddNoteErDef = EventReactionDef.define({
  name: 'addNote',
  label: 'Добавить заметку',
  description: 'К новой позиции добавляется заметка.',
  on: [ItemEvents.created],
  touches: [NoteArDef],
  calls: [GetItemUcDef],
  emits: [NoteEvents.added],
});

export const PurgeNotesJobDef = JobDef.define({
  name: 'purgeNotes',
  label: 'Чистка заметок',
  description: 'Удаляет старые заметки.',
  schedule: { kind: 'dailyAt', hour: 4, minute: 0 },
  scans: [NoteArDef],
});

export const AlphaModuleDef = ModuleDef.define({
  name: 'alpha',
  label: 'Заметки',
  description: 'Модуль, который зависит от каталога.',
  dependsOn: [BetaModuleDef],
  aggregates: [NoteArDef],
  useCases: [],
  reactions: [AddNoteErDef],
  jobs: [PurgeNotesJobDef],
});

/** Правило поставщика: сообщения заданы, вызовы и графы запоминаются. */
export class StubRule implements GraphRule {
  readonly graphs: Graph[] = [];

  constructor(
    readonly id: string,
    private readonly messages: readonly string[] = [],
  ) {}

  check(graph: Graph): readonly string[] {
    this.graphs.push(graph);
    return this.messages;
  }
}

/** `TOY-01`: заметка без вложенных узлов. */
export class NoteWithoutChildrenRule implements GraphRule {
  readonly id = 'TOY-01';

  check(graph: Graph): readonly string[] {
    return graph
      .nodes()
      .filter((n) => n.kind === 'note' && graph.children(n.id).length === 0)
      .map((n) => `заметка ${n.id} без вложений`);
  }
}

const NOTE_KINDS: GraphKinds = {
  nodes: [
    { kind: 'note', label: 'Заметка', description: 'Заметка поставщика.' },
  ],
  edges: [],
};

/** Узел `toy` вида `note` под корнем учебного приложения. */
export const TOY_NODE: GraphNodeInput = {
  kind: 'note',
  id: 'example/toy',
  label: 'Заметка',
  description: 'Заметка игрушечного поставщика.',
};

/**
 * Игрушечный поставщик графа с правилами: вид `note`, узел под корнем
 * `example`. `rules` нет, если не переданы; `contributed` считает вызовы
 * `contribute` — по нему видно, строился ли граф.
 */
export class RuleProvider implements GraphProvider {
  readonly version = '1.0.0';
  contributed = 0;
  readonly rules?: () => readonly GraphRule[];

  constructor(
    readonly name: string,
    rules?: readonly GraphRule[],
    private readonly nodes: readonly GraphNodeInput[] = [],
  ) {
    if (rules) this.rules = () => rules;
  }

  kinds(): GraphKinds {
    return this.nodes.length > 0 ? NOTE_KINDS : { nodes: [], edges: [] };
  }

  contribute(): GraphContribution {
    this.contributed += 1;
    return { nodes: this.nodes, edges: [] };
  }
}

/** `toy` с узлом-заметкой и правилом `TOY-01`. */
export const toyRuleProvider = (): RuleProvider =>
  new RuleProvider('toy', [new NoteWithoutChildrenRule()], [TOY_NODE]);
