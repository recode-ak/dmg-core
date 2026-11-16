import type { StateOf } from '#core/domain/aggregate/aggregate.types';
import { TaskAr, TaskArDef } from '#core/testing/example/todo/index';
import { MemoryRepo } from '#core/testing/memory-repo';
import type { TaskRepo } from './task.repo';

/**
 * Фейк порта `TaskRepo` для тестов UC/ER/Job: запись — память базы,
 * `findById` — по uuid из памяти, выборки (`find*`) — ответ, который задаёт
 * тест присваиванием поля.
 */
export class TaskRepoFake
  extends MemoryRepo<TaskAr, StateOf<typeof TaskArDef>>
  implements TaskRepo
{
  constructor() {
    super(TaskArDef, TaskAr.restore);
  }

  findById = async (uuid: string) => this.restored(uuid);
  findActiveByOwner = this.unanswered<[ownerId: string], TaskAr[]>(
    'findActiveByOwner',
  );
  findActiveByParticipant = this.unanswered<[userId: string], TaskAr[]>(
    'findActiveByParticipant',
  );
  findActiveByAssignee = this.unanswered<[userId: string], TaskAr[]>(
    'findActiveByAssignee',
  );
  findDone = this.unanswered<[], TaskAr[]>('findDone');
}
