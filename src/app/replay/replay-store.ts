import type { Timestamp } from '#core/kernel/time/timestamp';
import type { Clock } from '../context';

/**
 * Итог `ReplayStore.claim`: `claimed` — ключ занят, команду можно
 * исполнять, `token` — владелец записи для `complete`/`release`; `answered` — тот же вход уже исполнен, `answer` — сохранённый
 * ответ; `conflict` — `input`: тот же ключ с другим входом, `in_progress`:
 * первый запрос ещё исполняется (D-56).
 */
export type ReplayClaim =
  | { readonly kind: 'claimed'; readonly token: string }
  | { readonly kind: 'answered'; readonly answer: unknown }
  | { readonly kind: 'conflict'; readonly reason: 'input' | 'in_progress' };

/**
 * Порт отсева повторов command UC по `requestId` (D-56) — аналог inbox
 * событий для входа транспорта. `key` — модуль, вызывающий и `requestId`;
 * `input` — канонический JSON `{ uc, input }`; обе строки строит `dispatch`.
 * `claim` занимает ключ до исполнения (запись «в работе») и выдаёт токен
 * владельца или сообщает, что ключ уже есть. Проверка и занятие — одна
 * атомарная операция: два параллельных `claim` не займут ключ оба
 * (файловое или общее хранилище — блокировка или сравнение с заменой).
 * `complete` сохраняет ответ `Ok`, `release` снимает запись после `Err` —
 * повтор исполнится заново; оба — только владельцу: запись под ключом с
 * другим токеном (прежняя истекла или вытеснена, ключ занял новый запрос)
 * они не трогают. Ответ — JSON-совместимые данные; хранилище отдаёт копию,
 * а не сохранённый объект.
 */
export type ReplayStore = {
  claim(key: string, input: string): Promise<ReplayClaim>;
  complete(key: string, token: string, answer: unknown): Promise<void>;
  release(key: string, token: string): Promise<void>;
};

/** Сколько живёт запись отсева по умолчанию: 24 ч (D-56). */
export const DEFAULT_REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

/** Сколько последних записей помнит хранилище в процессе по умолчанию. */
export const DEFAULT_REPLAY_CAPACITY = 10_000;

/** Запись хранилища: владелец, вход, ответ (нет — «в работе»), срок жизни. */
type ReplayEntry = {
  readonly token: string;
  readonly input: string;
  readonly answered: boolean;
  readonly answer: unknown;
  readonly expiresAt: Timestamp;
};

/**
 * `ReplayStore` в памяти по умолчанию: записи живут `ttlMs` от последней
 * записи (`claim`, `complete`), время — из часов приложения (D-34); часы
 * предполагаются монотонными — иначе порядок записей перестаёт совпадать
 * с порядком истечения и истёкшие записи снимаются позже. Помнит не больше
 * `capacity` записей — самые старые забываются, в том числе «в работе»:
 * повтор такого запроса исполнится снова. Ответ хранится и отдаётся
 * копией (`structuredClone`). Атомарность `claim` даёт однопоточность
 * процесса: между проверкой и занятием нет `await`. Рестарт процесса
 * забывает всё: хранилище, переживающее рестарт, даёт приложение.
 */
export class InProcReplayStore implements ReplayStore {
  /** Порядок вставки — порядок последней записи, значит и истечения срока. */
  private readonly entries = new Map<string, ReplayEntry>();
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly capacity: number;

  constructor(options: {
    readonly clock: Clock;
    readonly ttlMs?: number;
    readonly capacity?: number;
  }) {
    this.clock = options.clock;
    this.ttlMs = options.ttlMs ?? DEFAULT_REPLAY_TTL_MS;
    this.capacity = options.capacity ?? DEFAULT_REPLAY_CAPACITY;
  }

  async claim(key: string, input: string): Promise<ReplayClaim> {
    this.forgetExpired();
    const entry = this.entries.get(key);
    if (entry === undefined) {
      const token = crypto.randomUUID();
      this.put(key, { token, input, answered: false, answer: undefined });
      return { kind: 'claimed', token };
    }
    if (entry.input !== input) return { kind: 'conflict', reason: 'input' };
    if (!entry.answered) return { kind: 'conflict', reason: 'in_progress' };
    return { kind: 'answered', answer: structuredClone(entry.answer) };
  }

  async complete(key: string, token: string, answer: unknown): Promise<void> {
    this.forgetExpired();
    const entry = this.entries.get(key);
    if (entry?.token !== token) return;
    this.put(key, {
      token,
      input: entry.input,
      answered: true,
      answer: structuredClone(answer),
    });
  }

  async release(key: string, token: string): Promise<void> {
    if (this.entries.get(key)?.token === token) this.entries.delete(key);
  }

  /** Записывает в конец порядка со свежим сроком и соблюдает ёмкость. */
  private put(key: string, entry: Omit<ReplayEntry, 'expiresAt'>): void {
    this.entries.delete(key);
    this.entries.set(key, { ...entry, expiresAt: this.clock() + this.ttlMs });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.capacity) break;
      this.entries.delete(oldest);
    }
  }

  /** Снимает истёкшие записи с начала порядка — они там самые старые. */
  private forgetExpired(): void {
    const now = this.clock();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) break;
      this.entries.delete(key);
    }
  }
}
