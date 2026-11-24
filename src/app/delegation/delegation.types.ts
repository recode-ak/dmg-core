import type { Timestamp } from '#core/kernel/time/timestamp';

/** Заявка на делегирование от транспорта (токен, сессия — его дело); D-89. */
export type DelegationClaim = {
  readonly principalId: string;
  readonly actorId: string;
  readonly delegationId: string;
};

/**
 * Запись делегирования, которую читает фреймворк. Начало срока и «кто выдал»
 * приложение хранит сверх этого — фреймворку они не нужны.
 */
export type DelegationRecord = {
  readonly delegationId: string;
  readonly principalId: string;
  readonly actorId: string;
  readonly expiresAt: Timestamp;
  readonly revoked: boolean;
  readonly readOnly: boolean;
};

/** Порт записей делегирования; реализует приложение. */
export type DelegationStore = {
  find(delegationId: string): Promise<DelegationRecord | undefined>;
};
