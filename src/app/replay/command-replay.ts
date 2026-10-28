import type { Command } from '#core/domain/contracts/command';
import type { AnyUseCaseDef } from '#core/domain/contracts/use-case-def';
import type { Caller } from '#core/kernel/caller/caller';
import { type CoreError, CoreErrors } from '#core/kernel/errors/core-errors';
import { serializeError } from '#core/kernel/errors/serialize-error';
import { ok, type Result } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import type { AppContext } from '../context';
import type { ReplayClaim } from './replay-store';

/**
 * Отсев повторов command UC модуля по `requestId` (D-56) поверх порта
 * `app.replay`. Отсеивается только command UC, у которого `requestId`
 * прислал клиент (`trace.clientRequestId`), а вызывающий — человек:
 * `user`, `delegate` или гость с `channel.visitorId`. Query, серверный
 * `requestId`, след события или Job, `system` и гость без посетителя —
 * исполняются как есть.
 *
 * Ключ — модуль, вызывающий и `requestId`; вход — канонический JSON
 * `{ uc, input }`. Повтор того же входа получает сохранённый `Ok` без
 * исполнения UC; другой вход или незавершённый первый запрос —
 * `REQUEST_CONFLICT`. Сохраняется только `Ok`: после `Err` или исключения
 * запись снимается, повтор исполнится заново.
 *
 * Сбой хранилища наружу не выходит (ERR-07): сбой `claim` — `SERVER_INTERNAL`
 * и `error` в логгер, UC не исполняется; сбой `complete` или `release` —
 * `error` в логгер, результат UC возвращается как есть.
 */
export class CommandReplay {
  constructor(
    private readonly module: string,
    private readonly app: Pick<AppContext, 'replay' | 'logger'>,
  ) {}

  async run<O, E>(
    def: AnyUseCaseDef,
    command: Command,
    caller: Caller,
    trace: Trace,
    execute: () => Promise<Result<O, E>>,
  ): Promise<Result<O, E | CoreError>> {
    const requestId = trace.clientRequestId;
    const who = CommandReplay.callerKey(caller, trace);
    if (
      def.type !== 'command' ||
      requestId === undefined ||
      who === undefined
    ) {
      return execute();
    }
    const source = `${this.module}.${command.uc}`;
    const key = JSON.stringify([this.module, ...who, requestId]);
    const input = CommandReplay.canonical({
      uc: command.uc,
      input: command.input,
    });
    let claim: ReplayClaim;
    try {
      claim = await this.app.replay.claim(key, input);
    } catch (error) {
      this.app.logger.error(
        source,
        `Не удалось занять запрос ${requestId}`,
        serializeError(error),
      );
      return CoreErrors.SERVER_INTERNAL.err();
    }
    if (claim.kind === 'answered') {
      // Ответ сохранён под тем же ключом и тем же `{ uc, input }`, а имя UC
      // в модуле уникально: это `Ok` того же UC, то есть его выход `O`.
      return ok(claim.answer as O);
    }
    if (claim.kind === 'conflict') {
      return CoreErrors.REQUEST_CONFLICT.err({
        requestId,
        reason: claim.reason,
      });
    }
    let res: Result<O, E>;
    try {
      res = await execute();
    } catch (error) {
      await this.settle(source, requestId, () => this.app.replay.release(key));
      throw error;
    }
    await this.settle(source, requestId, () =>
      res.ok
        ? this.app.replay.complete(key, res.value)
        : this.app.replay.release(key),
    );
    return res;
  }

  /** `complete` или `release`; сбой — `error` в логгер (ERR-07). */
  private async settle(
    source: string,
    requestId: string,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      this.app.logger.error(
        source,
        `Не удалось записать итог запроса ${requestId}`,
        serializeError(error),
      );
    }
  }

  /**
   * Часть ключа о вызывающем: `user` — субъект, `delegate` — субъект и
   * заместитель, гость — канал и посетитель. Нет — без отсева: `system`
   * (повтор определяет внешняя операция) и гость без посетителя (иначе один
   * гость получит ответ другого).
   */
  private static callerKey(
    caller: Caller,
    trace: Trace,
  ): readonly string[] | undefined {
    const log = caller.toLog();
    switch (log.kind) {
      case 'user':
        return ['user', log.subjectId];
      case 'delegate':
        return ['delegate', log.subjectId, log.actorId];
      case 'guest': {
        const visitorId = trace.channel?.visitorId;
        if (visitorId === undefined) return undefined;
        return ['guest', trace.channel?.name ?? '', visitorId];
      }
      case 'system':
        return undefined;
    }
  }

  /** JSON с отсортированными ключами объектов: порядок ключей — не вход. */
  private static canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return item;
      }
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });
  }
}
