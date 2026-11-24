import type { StateOf } from '#core/domain/aggregate/aggregate.types';
import {
  UserAr,
  UserArDef,
} from '#core/testing/example/platform/domain/users/index';
import { MemoryRepo } from '#core/testing/memory-repo';
import type { UserRepo } from './user.repo';

/** Фейк порта `UserRepo` для тестов UC: `findById` — по uuid из памяти. */
export class UserRepoFake
  extends MemoryRepo<UserAr, StateOf<typeof UserArDef>>
  implements UserRepo
{
  constructor() {
    super(UserArDef, UserAr.restore);
  }

  findById = async (uuid: string) => this.restored(uuid);
}
