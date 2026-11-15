import type { DelegationRecord, DelegationStore } from '#core/app/index';

/** Порт делегирований образца: записи в памяти (D-89). */
export class ExampleDelegationStore implements DelegationStore {
  private readonly records: Map<string, DelegationRecord>;

  constructor(records: readonly DelegationRecord[] = []) {
    this.records = new Map(records.map((r) => [r.delegationId, r]));
  }

  async find(delegationId: string): Promise<DelegationRecord | undefined> {
    return this.records.get(delegationId);
  }
}
