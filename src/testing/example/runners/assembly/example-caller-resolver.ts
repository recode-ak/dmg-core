import type { ApiApp } from '#core/app/api-app/api-app';
import type { Clock } from '#core/app/context';
import {
  DelegationCheck,
  type DelegationClaim,
  type DelegationDenied,
  type DelegationStore,
} from '#core/app/index';
import {
  DelegateCaller,
  GuestCaller,
  type OperationRef,
  type PersonCaller,
  SystemCaller,
  UserCaller,
} from '#core/kernel/caller/caller';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { ok, type Result } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import {
  GetUserUcDef,
  UserErrors,
  UsersModuleDef,
} from '#core/testing/example/platform/domain/users/contract';
import type { ExampleUser } from '../../platform/kernel/app-user';

/**
 * Откуда вызов `users` при разборе вызывающего (D-51, D-104): `getUser` от
 * системы проходит без Policy, резолвер — вход корня сборки.
 */
const RESOLVER: OperationRef = {
  kind: 'app',
  module: 'example-app',
  name: 'resolveCaller',
};

const INVALID = () => CoreErrors.DELEGATION_DENIED.err({ reason: 'invalid' });

/**
 * Резолвер `Caller` приложения (D-89): идентичность → человек на входе.
 * Нет идентичности, пользователя или он удалён — гость; прочий отказ
 * `getUser` — исключение (ERR-01): тихий гость спрятал бы дефект.
 * С заявкой — `DelegateCaller` или `DELEGATION_DENIED`: заявка при
 * отказе в `UserCaller` не превращается.
 * @see src/testing/example/runners/assembly/example-delegation.test.ts
 */
export class ExampleCallerResolver {
  private readonly system = new SystemCaller<ExampleUser>(RESOLVER);
  private readonly check: DelegationCheck;

  constructor(
    private readonly api: ApiApp<ExampleUser>,
    delegations: DelegationStore | undefined,
    clock: Clock,
  ) {
    this.check = new DelegationCheck(delegations, clock);
  }

  async resolve(
    uuid: string | undefined,
    trace: Trace,
    claim?: DelegationClaim,
  ): Promise<Result<PersonCaller<ExampleUser>, DelegationDenied>> {
    if (claim) return this.delegate(uuid, trace, claim);
    return ok(await this.person(uuid, trace));
  }

  private async delegate(
    uuid: string | undefined,
    trace: Trace,
    claim: DelegationClaim,
  ): Promise<Result<DelegateCaller<ExampleUser>, DelegationDenied>> {
    const { principalId, actorId, delegationId } = claim;
    if (!principalId || !actorId || !delegationId) return INVALID();
    if (uuid === undefined || uuid !== actorId) return INVALID();
    const verified = await this.check.verify(claim);
    if (!verified.ok) return verified;
    const principal = await this.activeUser(principalId, trace);
    const actor = await this.activeUser(actorId, trace);
    if (!principal || !actor) return INVALID();
    return ok(
      new DelegateCaller(
        principal,
        actor,
        delegationId,
        verified.value.readOnly,
      ),
    );
  }

  private async person(
    uuid: string | undefined,
    trace: Trace,
  ): Promise<PersonCaller<ExampleUser>> {
    if (uuid === undefined) return new GuestCaller();
    const user = await this.activeUser(uuid, trace);
    return user ? new UserCaller(user) : new GuestCaller();
  }

  /** Пользователь, если он есть и активен; прочий отказ `getUser` — дефект. */
  private async activeUser(
    uuid: string,
    trace: Trace,
  ): Promise<ExampleUser | undefined> {
    const res = await this.api.dispatch(
      UsersModuleDef,
      GetUserUcDef.command({ userId: uuid }),
      this.system,
      trace,
    );
    if (!res.ok) {
      if (res.error.code === UserErrors.NOT_FOUND.code) return undefined;
      throw new Error(
        `Резолвер Caller: users.getUser вернул ${res.error.code}`,
      );
    }
    return res.value.active ? this.user(uuid) : undefined;
  }

  // Ролей в домене users нет — субъект без ролей.
  private user(uuid: string): ExampleUser {
    return { uuid, hasRole: () => false };
  }
}
