import { CoreErrors } from '#core/kernel/errors/core-errors';
import type { ErrorOf } from '#core/kernel/errors/error-def';
import { ok, type Result } from '#core/kernel/result/result';
import type { Clock } from '../context';
import type {
  DelegationClaim,
  DelegationRecord,
  DelegationStore,
} from './delegation.types';

export type DelegationDenied = ErrorOf<typeof CoreErrors.DELEGATION_DENIED>;

/**
 * Проверка заявки на делегирование на каждом запросе (D-89). Нет записи и
 * чужая пара — одна причина `invalid`: не раскрывать, что запись есть.
 * Исключение порта не ловится — это дефект хранилища, а не отказ (ERR-01).
 */
export class DelegationCheck {
  constructor(
    private readonly store: DelegationStore | undefined,
    private readonly clock: Clock,
  ) {}

  async verify(
    claim: DelegationClaim,
  ): Promise<Result<DelegationRecord, DelegationDenied>> {
    if (!this.store) {
      return CoreErrors.DELEGATION_DENIED.err({ reason: 'disabled' });
    }
    const record = await this.store.find(claim.delegationId);
    if (
      !record ||
      record.principalId !== claim.principalId ||
      record.actorId !== claim.actorId
    ) {
      return CoreErrors.DELEGATION_DENIED.err({ reason: 'invalid' });
    }
    if (record.revoked) {
      return CoreErrors.DELEGATION_DENIED.err({ reason: 'revoked' });
    }
    // Не `>=`: срок не числом (NaN из данных приложения) — истёк, а не бессрочен.
    if (!(this.clock() < record.expiresAt)) {
      return CoreErrors.DELEGATION_DENIED.err({ reason: 'expired' });
    }
    return ok(record);
  }
}
