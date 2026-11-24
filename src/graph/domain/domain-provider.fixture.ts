// Фикстура поставщика домена (D-95): модули `notes`, `shop`, `cart`, их
// приложения и локальные Def для признаков, сирот и повторов.
import * as v from 'valibot';
import { AggregateDef } from '../../domain/aggregate/aggregate-def';
import { type AnyAppDef, AppDef } from '../../domain/contracts/app-def';
import { EventReactionDef } from '../../domain/contracts/event-reaction-def';
import { JobDef } from '../../domain/contracts/job-def';
import { ModuleDef } from '../../domain/contracts/module-def';
import {
  type AnyUseCaseDef,
  UseCaseDef,
} from '../../domain/contracts/use-case-def';
import { EventDef } from '../../domain/events/event-def';
import { allowAll } from '../../domain/policy/rule';
import { DomainRuleDef } from '../../domain/rules/domain-rule-def';
import { CoreErrors } from '../../kernel/errors/core-errors';
import { ErrorDef } from '../../kernel/errors/error-def';
import { BaseEntityFields, F } from '../../kernel/fields/fields';
import { ok } from '../../kernel/result/result';
import {
  CompleteTaskUcDef,
  GetTaskUcDef,
  TaskEvents,
  TodoModuleDef,
} from '../../testing/example/platform/domain/todo';
import type { Graph } from '../graph';
import type { GraphEdge } from '../graph.types';
import { GraphBuilder } from '../graph-builder';
import { DomainProvider } from './domain-provider';

/** Граф одного приложения — только вклад поставщика домена. */
export const domainGraph = (app: AnyAppDef): Graph =>
  new GraphBuilder().add(new DomainProvider(app)).build();

/** Рёбра строками `from kind to` — для сверки в каноническом порядке. */
export const edgeKeys = (edges: readonly GraphEdge[]): string[] =>
  edges.map((e) => `${e.from} ${e.kind} ${e.to}`);

const emptyState = v.object({ ...BaseEntityFields });
const emptyIo = v.object({});

// ── notes: вызовы чужого модуля, внутримодульная подписка ───────────────────

// `completeTask` система не вызывает (нет `'system'` в `callers`), и тип
// `calls` его не пропустит; здесь он цель-command для графа — список расширен
// до общего типа (граф строится и по таким Def, отказ — забота `DefChecker`).
const NOTIFY_CALLS: readonly AnyUseCaseDef[] = [
  GetTaskUcDef,
  CompleteTaskUcDef,
];

export const NoteEvents = EventDef.define('notes.note', {
  added: {
    label: 'Заметка добавлена',
    description: 'К задаче добавлена заметка.',
    payload: emptyIo,
  },
});

export const NoteArDef = AggregateDef.define({
  name: 'note',
  label: 'Заметка',
  description: 'Заметка к задаче.',
  state: emptyState,
  events: NoteEvents,
  errors: {},
});

export const NotifyTodoErDef = EventReactionDef.define({
  name: 'notifyTodo',
  label: 'Сообщить о задаче',
  description: 'Читает задачу и завершает её через фасад todo.',
  on: [TaskEvents.created],
  calls: NOTIFY_CALLS,
});

/** Внутримодульная подписка: ER и событие одного модуля. */
export const IndexNoteErDef = EventReactionDef.define({
  name: 'indexNote',
  label: 'Проиндексировать заметку',
  description: 'Реагирует на добавление заметки своего модуля.',
  on: [NoteEvents.added],
  touches: [NoteArDef],
});

export const ShowTaskUcDef = UseCaseDef.define({
  name: 'showTask',
  label: 'Показать задачу',
  description: 'Задача к заметке — через фасад todo.',
  type: 'query',
  aggregate: NoteArDef,
  callers: ['user'],
  policy: allowAll,
  calls: [GetTaskUcDef],
  input: emptyIo,
  output: emptyIo,
  errors: [],
});

/** Публикует событие своего же модуля — внутримодульный `emits`. */
export const AddNoteUcDef = UseCaseDef.define({
  name: 'addNote',
  label: 'Добавить заметку',
  description: 'Добавляет заметку и публикует событие.',
  type: 'command',
  aggregate: NoteArDef,
  callers: ['user'],
  policy: allowAll,
  input: emptyIo,
  output: emptyIo,
  errors: [],
  emits: [NoteEvents.added],
});

export const SweepJobDef = JobDef.define({
  name: 'sweep',
  label: 'Чистка',
  description: 'Проверяет задачи заметок.',
  schedule: { kind: 'dailyAt', hour: 5, minute: 0 },
  calls: [GetTaskUcDef],
});

export const NotesModuleDef = ModuleDef.define({
  name: 'notes',
  label: 'Заметки',
  description: 'Модуль для связей «операция → UC» и подписок.',
  dependsOn: [TodoModuleDef],
  aggregates: [NoteArDef],
  useCases: [ShowTaskUcDef, AddNoteUcDef],
  reactions: [NotifyTodoErDef, IndexNoteErDef],
  jobs: [SweepJobDef],
});

export const NotesAppDef = AppDef.define({
  name: 'notes-app',
  label: 'Приложение заметок',
  description: 'Заметки поверх учебных задач.',
  modules: [NotesModuleDef, TodoModuleDef],
});

/** Состав — только корневой модуль: остальное подтягивает замыкание. */
export const TodoOnlyAppDef = AppDef.define({
  name: 'todo-only',
  label: 'Только задачи',
  description: 'В составе один модуль, users — по dependsOn.',
  modules: [TodoModuleDef],
});

// ── shop и cart: правила с одним именем, правило чужого модуля ───────────────

/**
 * Агрегат `name` с ошибкой `<PREFIX>_DUPLICATE` и правилом `unique` на неё.
 */
export function withUniqueRule(name: string, prefix: string) {
  const errors = ErrorDef.define(prefix, {
    DUPLICATE: {
      kind: 'conflict',
      label: 'Дубль',
      description: 'Такая запись уже есть.',
    },
  });
  const ArDef = AggregateDef.define({
    name,
    label: name,
    description: `Агрегат ${name}.`,
    state: emptyState,
    events: {},
    errors,
  });
  const unique = DomainRuleDef.define({
    name: 'unique',
    label: 'Запись уникальна',
    description: 'Дубль не создаётся.',
    error: errors.DUPLICATE,
    check: (_: unknown) => ok(),
  });
  return { ArDef, errors, unique };
}

/** UC `name` над агрегатом `a`, ссылается на `rule` (по умолчанию — своё). */
export const ruleUc = (
  name: string,
  a: ReturnType<typeof withUniqueRule>,
  rule = a.unique,
) =>
  UseCaseDef.define({
    name,
    label: name,
    description: `UC ${name}.`,
    type: 'command',
    aggregate: a.ArDef,
    callers: ['user'],
    policy: allowAll,
    input: emptyIo,
    output: emptyIo,
    errors: [rule.error],
    rules: [rule],
  });

export const shopItem = withUniqueRule('item', 'ITEM');
export const shopOrder = withUniqueRule('order', 'ORDER');

export const ShopModuleDef = ModuleDef.define({
  name: 'shop',
  label: 'Магазин',
  description: 'Два агрегата с правилом unique.',
  dependsOn: [],
  aggregates: [shopItem.ArDef, shopOrder.ArDef],
  useCases: [ruleUc('createItem', shopItem), ruleUc('createOrder', shopOrder)],
  reactions: [],
  jobs: [],
});

export const cartLine = withUniqueRule('line', 'LINE');

export const CartModuleDef = ModuleDef.define({
  name: 'cart',
  label: 'Корзина',
  description: 'UC с правилом чужого модуля.',
  dependsOn: [ShopModuleDef],
  aggregates: [cartLine.ArDef],
  useCases: [ruleUc('addLine', cartLine, shopItem.unique)],
  reactions: [],
  jobs: [],
});

export const ShopAppDef = AppDef.define({
  name: 'shop-app',
  label: 'Магазин',
  description: 'Приложение из одного модуля.',
  modules: [ShopModuleDef],
});

export const CartAppDef = AppDef.define({
  name: 'cart-app',
  label: 'Корзина',
  description: 'Корзина поверх магазина.',
  modules: [CartModuleDef, ShopModuleDef],
});

/** Масштаб приложения — свойство узла `app`. */
export const ScaledAppDef = AppDef.define({
  name: 'scaled',
  label: 'Школа',
  description: 'Приложение с меткой масштаба.',
  scale: 'school',
  modules: [ShopModuleDef],
});

// ── portal: признаки visible и exposed, базовая ошибка ──────────────────────

export const PageErrors = ErrorDef.define('PAGE', {
  MISSING: {
    kind: 'not_found',
    label: 'Страница не найдена',
    description: 'Страницы с таким идентификатором нет.',
    visible: true,
  },
});

export const PageEvents = EventDef.define('portal.page', {
  published: {
    label: 'Страница опубликована',
    description: 'Страница стала доступна читателям.',
    payload: v.object({ pageId: F.uuid('страницы') }),
    exposed: true,
    visible: true,
  },
});

export const PageArDef = AggregateDef.define({
  name: 'page',
  label: 'Страница',
  description: 'Страница портала.',
  visible: true,
  state: emptyState,
  events: PageEvents,
  errors: PageErrors,
});

/** Публичный, видимый UC с базовой ошибкой ядра в `errors`. */
export const PublishPageUcDef = UseCaseDef.define({
  name: 'publishPage',
  label: 'Опубликовать страницу',
  description: 'Публикует страницу.',
  type: 'command',
  aggregate: PageArDef,
  callers: ['user'],
  policy: allowAll,
  exposed: true,
  visible: true,
  input: emptyIo,
  output: emptyIo,
  errors: [PageErrors.MISSING, CoreErrors.UNAUTHORIZED],
  emits: [PageEvents.published],
});

/** Контраст: без признаков и без базовых ошибок. */
export const UnlistPageUcDef = UseCaseDef.define({
  name: 'unlistPage',
  label: 'Скрыть страницу',
  description: 'Снимает страницу с публикации.',
  type: 'command',
  aggregate: PageArDef,
  callers: ['user'],
  policy: allowAll,
  input: emptyIo,
  output: emptyIo,
  errors: [],
});

export const PortalModuleDef = ModuleDef.define({
  name: 'portal',
  label: 'Портал',
  description: 'Модуль с признаками видимости и публичности.',
  visible: true,
  dependsOn: [],
  aggregates: [PageArDef],
  useCases: [PublishPageUcDef, UnlistPageUcDef],
  reactions: [],
  jobs: [],
});

export const PortalAppDef = AppDef.define({
  name: 'site',
  label: 'Сайт',
  description: 'Приложение с видимыми Def.',
  visible: true,
  modules: [PortalModuleDef],
});

// ── orphanage: Def вне модулей (сироты) ─────────────────────────────────────

export const StrayErrors = ErrorDef.define('STRAY', {
  GONE: {
    kind: 'not_found',
    label: 'Пропало',
    description: 'Запись пропала.',
  },
});

export const StrayEvents = EventDef.define('lost.stray', {
  happened: {
    label: 'Случилось',
    description: 'Что-то случилось с потерянной записью.',
    payload: emptyIo,
  },
});

/** Агрегат, которого нет ни в одном модуле: его события и ошибки — сироты. */
export const StrayArDef = AggregateDef.define({
  name: 'stray',
  label: 'Потерянный',
  description: 'Агрегат вне модулей.',
  state: emptyState,
  events: StrayEvents,
  errors: StrayErrors,
});

export const StrayRuleDef = DomainRuleDef.define({
  name: 'strayCheck',
  label: 'Потерянная проверка',
  description: 'Правило с ошибкой вне модулей.',
  error: StrayErrors.GONE,
  check: (_: unknown) => ok(),
});

/** UC вне модулей; `system` в `callers` — его можно указать в `calls`. */
export const StrayUcDef = UseCaseDef.define({
  name: 'strayQuery',
  label: 'Потерянный запрос',
  description: 'UC вне модулей.',
  type: 'query',
  aggregate: StrayArDef,
  callers: ['user', 'system'],
  policy: allowAll,
  input: emptyIo,
  output: emptyIo,
  errors: [],
});

export const HomeArDef = AggregateDef.define({
  name: 'home',
  label: 'Дом',
  description: 'Агрегат модуля со ссылками на сирот.',
  state: emptyState,
  events: {},
  errors: {},
});

/** Ссылается на агрегат, UC, событие, ошибку и правило вне модулей. */
export const TouchStrayUcDef = UseCaseDef.define({
  name: 'touchStray',
  label: 'Тронуть потерянное',
  description: 'Ссылки на Def вне модулей.',
  type: 'command',
  aggregate: StrayArDef,
  callers: ['user'],
  policy: allowAll,
  calls: [StrayUcDef],
  rules: [StrayRuleDef],
  input: emptyIo,
  output: emptyIo,
  errors: [StrayErrors.GONE],
  emits: [StrayEvents.happened],
});

export const WatchStrayErDef = EventReactionDef.define({
  name: 'watchStray',
  label: 'Следить за потерянным',
  description: 'Подписка на событие вне модулей.',
  on: [StrayEvents.happened],
  touches: [HomeArDef],
});

export const OrphanageModuleDef = ModuleDef.define({
  name: 'orphanage',
  label: 'Приют',
  description: 'Модуль, ссылающийся на Def вне модулей.',
  dependsOn: [],
  aggregates: [HomeArDef],
  useCases: [TouchStrayUcDef],
  reactions: [WatchStrayErDef],
  jobs: [],
});

export const OrphanageAppDef = AppDef.define({
  name: 'orphanage-app',
  label: 'Приют',
  description: 'Приложение с Def вне модулей.',
  modules: [OrphanageModuleDef],
});

// ── повтор ссылки в Def ─────────────────────────────────────────────────────

export const dupEntry = withUniqueRule('entry', 'ENTRY');

/** Правило указано в `rules` дважды — о нём сообщает `arch:check`, не граф. */
export const DupRuleUcDef = UseCaseDef.define({
  name: 'addEntry',
  label: 'Добавить запись',
  description: 'UC с правилом дважды.',
  type: 'command',
  aggregate: dupEntry.ArDef,
  callers: ['user'],
  policy: allowAll,
  input: emptyIo,
  output: emptyIo,
  errors: [dupEntry.errors.DUPLICATE],
  rules: [dupEntry.unique, dupEntry.unique],
});

export const DupModuleDef = ModuleDef.define({
  name: 'dup',
  label: 'Повторы',
  description: 'UC с правилом дважды.',
  dependsOn: [],
  aggregates: [dupEntry.ArDef],
  useCases: [DupRuleUcDef],
  reactions: [],
  jobs: [],
});

export const DupAppDef = AppDef.define({
  name: 'dup-app',
  label: 'Повторы',
  description: 'Приложение с повтором ссылки.',
  modules: [DupModuleDef],
});

// ── внешний модуль и событие не по MAN-08 ───────────────────────────────────

export const VendorArDef = AggregateDef.define({
  name: 'part',
  label: 'Деталь',
  description: 'Агрегат внешнего модуля.',
  state: emptyState,
  events: {},
  errors: {},
});

export const VendorModuleDef = ModuleDef.define({
  name: 'vendor',
  label: 'Поставщик',
  description: 'Внешний модуль: известен только контракт.',
  external: true,
  dependsOn: [],
  aggregates: [VendorArDef],
  useCases: [],
  reactions: [],
  jobs: [],
});

/** Префикс `odd.name` не совпадает с `<модуль>.<агрегат>` (MAN-08). */
export const OddEvents = EventDef.define('odd.name', {
  thing: {
    label: 'Случилось',
    description: 'Событие с именем не по MAN-08.',
    payload: emptyIo,
  },
});

export const ThingArDef = AggregateDef.define({
  name: 'thing',
  label: 'Вещь',
  description: 'Агрегат с событием не по MAN-08.',
  state: emptyState,
  events: OddEvents,
  errors: {},
});

export const LegacyModuleDef = ModuleDef.define({
  name: 'legacy',
  label: 'Наследие',
  description: 'Внешний модуль в зависимостях и событие не по MAN-08.',
  dependsOn: [VendorModuleDef],
  aggregates: [ThingArDef],
  useCases: [],
  reactions: [],
  jobs: [],
});

export const LegacyAppDef = AppDef.define({
  name: 'legacy-app',
  label: 'Наследие',
  description: 'В составе — один модуль, vendor подтягивается.',
  modules: [LegacyModuleDef],
});
