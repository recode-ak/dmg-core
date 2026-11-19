import * as v from 'valibot';
import { type OutputOf, UseCaseDef } from '#core/domain/contracts/use-case-def';
import { F } from '#core/kernel/fields/fields';
import { UserArDef } from '../user.ar';
import { UserErrors } from '../user.errors';
import { UserPolicy } from '../user.policy';
import { UserState } from '../user.state';

/**
 * Пользователь для других модулей и человека (D-43, D-104): системе через
 * фасад `users` — без Policy, человеку — по праву `canView`. Выход — ответ
 * «активен ли», а не state: решение о статусе принимает `users`
 * (`UserAr.isActive`), вызывающий его только переводит в своё правило.
 */
export const GetUserUcDef = UseCaseDef.define({
  name: 'getUser',
  label: 'Пользователь',
  description:
    'Активна ли учётная запись: другим модулям (system) и человеку по праву canView (сам или администратор); нет пользователя — USER_NOT_FOUND.',
  type: 'query',
  aggregate: UserArDef,
  callers: ['system', 'user'],
  visible: true,
  policy: UserPolicy.rules.canView,
  input: v.object({ userId: UserState.entries.uuid }),
  output: v.object({
    userId: UserState.entries.uuid,
    active: F.boolean('Учётная запись активна'),
  }),
  errors: [UserErrors.NOT_FOUND],
});

/** Ответ `users` об учётной записи — контекст правил вызывающих модулей. */
export type UserActivity = OutputOf<typeof GetUserUcDef>;
