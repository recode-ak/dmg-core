import type { UnitOfWork } from '#core/app/uow/unit-of-work';
import { UseCaseFromDef } from '#core/app/use-case/use-case-from-def';
import type { Caller } from '#core/kernel/caller/caller';
import { ok } from '#core/kernel/result/result';
import type { UsersDeps } from '#core/testing/example/app/users/users.module';
import type { ExampleUser } from '#core/testing/example/shared/app-user';
import {
  GetUserUcDef,
  type UserAr,
  UserErrors,
  type UsersModuleDef,
} from '#core/testing/example/users/index';

type Loaded = { readonly user: UserAr };

/** Активна ли учётная запись — решает `UserAr`; право человека — `canView`. */
export class GetUserUc extends UseCaseFromDef<
  typeof GetUserUcDef,
  UsersDeps,
  Loaded,
  ExampleUser
> {
  constructor(deps: UsersDeps, module: typeof UsersModuleDef) {
    super(GetUserUcDef, deps, module);
  }

  protected async load({ userId }: { userId: string }) {
    const user = await this.resolve.users.findById(userId);
    return user ? ok({ user }) : UserErrors.NOT_FOUND.err({ userId });
  }

  /**
   * Системный вызов — без Policy, и с человеком за ним (D-58, D-104): право
   * на операцию уже решил вызывающий — резолвер или `canManage` у
   * `assignTask`, а `canView` отклонил бы человека за ним.
   */
  protected override checkPolicy(loaded: Loaded, caller: Caller<ExampleUser>) {
    if (caller.kind === 'system') return ok();
    return super.checkPolicy(loaded, caller);
  }

  protected async execute(_: unknown, { user }: Loaded, __: UnitOfWork) {
    return ok({ userId: user.uuid, active: user.isActive() });
  }
}
