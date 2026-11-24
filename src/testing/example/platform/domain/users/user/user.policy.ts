import type { ReadonlyAr } from '#core/domain/aggregate/readonly-ar';
import { PolicyDef } from '#core/domain/policy/policy-def';
import { Rule } from '#core/domain/policy/rule';
import type { UserAr } from './user.ar';

/** Контекст правил пользователя: учётная запись, о которой спрашивают. */
type UserCtx = { readonly user: ReadonlyAr<UserAr> };

// Сравнение идентификаторов, а не поля state: `uuid` — идентичность Ar.
const isSelf = Rule.of({
  name: 'isSelf',
  label: 'Сам пользователь',
  denyMessage: 'Карточку видит только сам пользователь.',
  check: (subject: { readonly uuid: string }, ctx: UserCtx) =>
    ctx.user.uuid === subject.uuid,
});

export const UserPolicy = PolicyDef.define({
  name: 'user',
  label: 'Права на учётную запись',
  description:
    'Кто видит карточку пользователя: сам пользователь или администратор.',
  rules: {
    canView: Rule.anyOf(
      {
        name: 'canView',
        label: 'Сам пользователь или администратор',
        denyMessage:
          'Карточку пользователя видит сам пользователь или администратор.',
      },
      isSelf,
      Rule.hasRole('admin'),
    ),
  },
});
