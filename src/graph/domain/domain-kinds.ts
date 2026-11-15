import * as v from 'valibot';
import { ERROR_KINDS } from '../../kernel/errors/error';
import type { GraphKinds } from '../kind-registry.types';

/** Имя поставщика домена (D-95); оно же корень внешних `id` — базовых ошибок и Def вне модулей. */
export const DOMAIN_PROVIDER = 'dmg-core';

// Вложенное (JSON Schema, дерево политики, расписание, статусы) схема не
// раскрывает: глубину держит `normalize()` Def и его тесты.
const nested = v.record(v.string(), v.unknown());

/**
 * Виды узлов и рёбер домена (D-95) и схемы их свойств; данные, как
 * `ERROR_KINDS`. Имя вида узла — `dmg` его Def; порядок ключей свойств — как в
 * нормализованной форме Def. У рёбер домена свойств нет.
 */
export const DOMAIN_KINDS: GraphKinds = {
  nodes: [
    {
      kind: 'app',
      label: 'Приложение',
      description: 'Корень графа: доменное приложение по его AppDef.',
      props: v.strictObject({ scale: v.optional(v.string()) }),
    },
    {
      kind: 'module',
      label: 'Модуль',
      description: 'Модуль домена; `external` — реализован вне приложения.',
      props: v.strictObject({ external: v.boolean() }),
    },
    {
      kind: 'aggregate',
      label: 'Агрегат',
      description: 'Агрегат модуля: состояние, статусы и переходы.',
      props: v.strictObject({
        state: nested,
        statuses: v.optional(nested),
        transitions: v.optional(nested),
      }),
    },
    {
      kind: 'useCase',
      label: 'UC',
      description: 'Операция модуля по вызову: команда или запрос.',
      props: v.strictObject({
        exposed: v.boolean(),
        type: v.picklist(['command', 'query']),
        callers: v.array(v.string()),
        personal: v.boolean(),
        policy: nested,
        input: nested,
        output: nested,
      }),
    },
    {
      kind: 'eventReaction',
      label: 'Реакция на событие',
      description: 'Операция модуля, которую запускает событие.',
    },
    {
      kind: 'job',
      label: 'Задание',
      description: 'Операция модуля по расписанию.',
      props: v.strictObject({ schedule: nested }),
    },
    {
      kind: 'event',
      label: 'Событие',
      description: 'Событие агрегата; `name` — полное имя в шине и логе.',
      props: v.strictObject({
        name: v.string(),
        exposed: v.boolean(),
        payload: nested,
      }),
    },
    {
      kind: 'error',
      label: 'Ошибка',
      description: 'Ошибка агрегата; `kind` — вид ошибки из `ERROR_KINDS`.',
      props: v.strictObject({
        kind: v.picklist(ERROR_KINDS),
        payload: v.optional(nested),
      }),
    },
    {
      kind: 'domainRule',
      label: 'Доменное правило',
      description: 'Правило агрегата-владельца своей ошибки, проверяемое в UC.',
    },
  ],
  edges: [
    {
      kind: 'dependsOn',
      label: 'Зависит от',
      description: 'Модуль объявил зависимость от модуля.',
    },
    {
      kind: 'touches',
      label: 'Работает с агрегатом',
      description:
        'UC управляет агрегатом, реакция трогает, задание просматривает.',
    },
    {
      kind: 'calls',
      label: 'Вызывает UC',
      description: 'Операция вызывает UC другого модуля.',
    },
    {
      kind: 'emits',
      label: 'Публикует',
      description: 'Операция публикует событие.',
    },
    {
      kind: 'subscribes',
      label: 'Подписана на',
      description: 'Реакция подписана на событие.',
    },
    {
      kind: 'failsWith',
      label: 'Отказывает ошибкой',
      description:
        'UC объявил ошибку; доменное правило отказывает своей ошибкой.',
    },
    {
      kind: 'checks',
      label: 'Проверяет правило',
      description: 'UC проверяет доменное правило.',
    },
  ],
};
