import * as v from 'valibot';
import type { AnyModuleDef } from '#core/domain/contracts/module-def';
import type {
  AnyUseCaseDef,
  OutputOf,
  UseCaseErrorOf,
} from '#core/domain/contracts/use-case-def';
import type {
  Rule,
  RuleContextOf,
  RuleSubjectOf,
} from '#core/domain/policy/rule';
import type { DomainRuleDef } from '#core/domain/rules/domain-rule-def';
import type { Caller, Identified } from '#core/kernel/caller/caller';
import { CoreErrors } from '#core/kernel/errors/core-errors';
import { serializeError } from '#core/kernel/errors/serialize-error';
import { ok, type Result } from '#core/kernel/result/result';
import type { Trace } from '#core/kernel/trace/trace';
import type { ModuleDeps } from '../context';
import { OperationFromDef } from '../operation/operation-from-def';
import type { OperationRun } from '../oplog/operation-run';
import type { UnitOfWork } from '../uow/unit-of-work';

/** Вход после схемы — то, что получают `load` и `execute`. */
export type ParsedInputOf<D extends AnyUseCaseDef> = v.InferOutput<D['input']>;

/** Выход до схемы — то, что возвращает `execute`. */
export type RawOutputOf<D extends AnyUseCaseDef> = v.InferInput<D['output']>;

/** Субъект Policy UC: `Caller` должен его нести (и `uuid` — для лога). */
export type UseCaseSubjectOf<D extends AnyUseCaseDef> = RuleSubjectOf<
  D['policy']
> &
  Identified;

/** Контекст Policy UC: что `load` обязан загрузить (D-58). */
export type UseCaseContextOf<D extends AnyUseCaseDef> = RuleContextOf<
  D['policy']
>;

/**
 * Доменное правило UC так, как его видит исполнение: контекст — загруженное
 * `load` и `fetch` вместе (`C`), ошибка — из `errors` UC (ERR-02). Правило с
 * чужим контекстом или необъявленной ошибкой не подходит конструктору;
 * рантайм-проверку ошибки делает `DefChecker`.
 */
type UseCaseRule<D extends AnyUseCaseDef, C> = DomainRuleDef<
  C,
  D['errors'][number]
>;

/**
 * Что видно снаружи у реализации UC: Def и исполнение. Для хранения в модуле
 * и приложении — без приватных полей и строго контравариантной Policy,
 * поэтому реализации с разным `L` лежат рядом. `handle` — метод: хранилище
 * не должно делать `ApiApp` инвариантным по актору; строгую проверку
 * субъекта делает карта модуля (`ModuleMap`).
 */
export type UseCaseHandler<
  D extends AnyUseCaseDef = AnyUseCaseDef,
  U extends Identified = UseCaseSubjectOf<D>,
> = {
  readonly def: D;
  handle(
    input: unknown,
    caller: Caller<U>,
    trace: Trace,
  ): Promise<Result<OutputOf<D>, UseCaseErrorOf<D>>>;
};

/**
 * Реализация UC по Def (API-05). Наследник пишет `load` (контекст Policy),
 * при необходимости `fetch` (вызовы чужих модулей — после права, D-58) и
 * `execute` (операция домена + `uow.register`). Порядок, Policy, ошибки ядра, фиксация и публикация —
 * здесь (errors-result.md §3); свойства Def в наследнике не повторяются.
 * Шаги — `protected`: наследник может их переопределить (например,
 * ослабить `checkPolicy` для системного вызова, D-43) — под свою
 * ответственность.
 *
 * `L` — загруженное `load`: подтип контекста Policy (например,
 * `{ task: TaskAr }` для `{ task: ReadonlyAr<TaskAr> }`), поэтому Policy,
 * правила и операция видят одни и те же агрегаты. `F` — добытое `fetch`
 * (объект; без `fetch` — `unknown`, и `L & F` остаётся `L`); `L & F`
 * обязано подходить контекстам всех доменных правил (проверяет
 * конструктор).
 *
 * `U` — субъект вызывающего, который знает реализация: тип пользователя
 * замыкает приложение (D-04). Он не уже субъекта Policy; при `allowAll`
 * Policy о субъекте молчит, а реализации нужен, например, его `uuid`.
 */
export abstract class UseCaseFromDef<
  D extends AnyUseCaseDef,
  R extends ModuleDeps,
  L extends UseCaseContextOf<D>,
  U extends UseCaseSubjectOf<D> = UseCaseSubjectOf<D>,
  F = unknown,
> extends OperationFromDef<D, R> {
  private readonly policy: Rule<UseCaseSubjectOf<D>, UseCaseContextOf<D>>;
  private readonly rules: readonly UseCaseRule<D, L & F>[];

  /**
   * `module` — Def модуля-владельца: его передаёт `ModuleFromDef` (D-43),
   * наследник проксирует в `super`. UC не из его `useCases` — исключение
   * (ошибка сборки).
   */
  constructor(
    def: D & {
      readonly policy: Rule<UseCaseSubjectOf<D>, UseCaseContextOf<D>>;
      readonly rules?: readonly UseCaseRule<D, L & F>[];
    },
    resolve: R,
    module: AnyModuleDef,
  ) {
    super(def, resolve, module, 'useCase');
    this.policy = def.policy;
    this.rules = def.rules ?? [];
  }

  /**
   * `trace` — для вызова UC другого модуля (`this.call`). Ошибки —
   * объявленные в `errors` и базовые ядра: отказ UC другого модуля
   * (`ACCESS_DENIED`, `UNAUTHORIZED`, …) приходит как есть, и UC
   * возвращает его дальше (D-43).
   */
  protected abstract load(
    input: ParsedInputOf<D>,
    caller: Caller<U>,
    trace: Trace,
  ): Promise<Result<L, UseCaseErrorOf<D>>>;

  /**
   * Вызовы чужих модулей (`this.call`) и всё, что нужно только правилам и
   * операции, — после Policy (D-58): не-владелец не узнаёт ответ
   * зависимости, зависимость не получает лишний вызов. По умолчанию —
   * ничего; наследник, задавший `F`, обязан переопределить шаг. Ошибка
   * возвращается как есть, до UoW.
   */
  protected fetch(
    _input: ParsedInputOf<D>,
    _loaded: L,
    _caller: Caller<U>,
    _trace: Trace,
  ): Promise<Result<F, UseCaseErrorOf<D>>> {
    // `undefined` подходит только `F = unknown` — по умолчанию.
    return Promise.resolve(ok(undefined as F));
  }

  protected abstract execute(
    input: ParsedInputOf<D>,
    loaded: L & F,
    uow: UnitOfWork,
    caller: Caller<U>,
    trace: Trace,
  ): Promise<Result<RawOutputOf<D>, UseCaseErrorOf<D>>>;

  /**
   * Субъект вызывающего — для UC, которому он нужен (владелец новой
   * записи, «мои» записи). Без субъекта — `throw`: `callers` такого UC
   * не должен допускать guest/system, это баг Def.
   */
  protected subject(caller: Caller<U>): U {
    const subject = caller.subject();
    if (subject === undefined) {
      throw new Error(
        `UC ${this.def.name}: у вызывающего ${caller.kind} нет субъекта — проверьте callers`,
      );
    }
    return subject;
  }

  /**
   * Шаги: `checkCaller` → `parseInput` → `load` → `checkPolicy` →
   * `fetch` → `checkRules` → `execute` → `parseOutput` → фиксация (с публикацией) →
   * запись в лог операций (любой исход). Непредвиденное исключение —
   * `SERVER_INTERNAL` с записью в лог.
   */
  handle(
    input: unknown,
    caller: Caller<U>,
    trace: Trace,
  ): Promise<Result<OutputOf<D>, UseCaseErrorOf<D>>> {
    return this.journal({ input, caller, trace }, async (run) => {
      try {
        return await this.run(input, caller, trace, run);
      } catch (error) {
        this.resolve.app.logger.error(
          this.def.name,
          'Непредвиденный сбой UC',
          serializeError(error),
        );
        return CoreErrors.SERVER_INTERNAL.err();
      }
    });
  }

  /** Вид вызывающего — из `callers` Def; иначе `UNAUTHORIZED`. */
  protected checkCaller(caller: Caller<U>): Result<void, UseCaseErrorOf<D>> {
    if (!this.def.callers.includes(caller.kind)) {
      return CoreErrors.UNAUTHORIZED.err({ callerKind: caller.kind });
    }
    return ok();
  }

  /** Вход по схеме Def; иначе `INPUT_VALIDATION` с путями полей. */
  protected parseInput(
    input: unknown,
  ): Result<ParsedInputOf<D>, UseCaseErrorOf<D>> {
    const parsed = v.safeParse(this.def.input, input);
    if (!parsed.success) {
      return CoreErrors.INPUT_VALIDATION.err({ issues: issues(parsed) });
    }
    return ok(parsed.output);
  }

  /**
   * Policy Def по субъекту вызывающего — вызывается всегда (D-43, Р2):
   * правило без субъекта (guest, system без человека) — отказ
   * `ACCESS_DENIED`. Системный вызов без человека разрешается явно:
   * `allowAll` в Def системного UC или переопределение этого шага в
   * наследнике — его право и ответственность.
   */
  protected checkPolicy(
    loaded: L,
    caller: Caller<U>,
  ): Result<void, UseCaseErrorOf<D>> {
    const decision = this.policy.evaluate(caller.subject(), loaded);
    if (!decision.allowed) {
      const { rule, denyMessage } = decision;
      return CoreErrors.ACCESS_DENIED.err({ rule, denyMessage });
    }
    return ok();
  }

  /**
   * Ожидаемая версия от клиента (D-57): клиент присылает во входе
   * (`F.expectedVersion('<агрегата>')`) версию агрегата, которую видел; расходится с
   * текущей — `VERSION_CONFLICT`, не прислана — сверки нет. Шаг явный:
   * какой агрегат сверять, знает только UC. Вызывать первым шагом
   * `execute`, до операции: сверка идёт с текущей версией, после мутации
   * конфликт будет ложным. Policy, `fetch` и `rules` Def — раньше.
   */
  protected expectVersion(
    ar: {
      readonly aggregateName: string;
      readonly uuid: string;
      readonly version: number;
    },
    expected: number | undefined,
  ): Result<void, UseCaseErrorOf<D>> {
    if (expected === undefined || expected === ar.version) return ok();
    return CoreErrors.VERSION_CONFLICT.err({
      aggregate: ar.aggregateName,
      uuid: ar.uuid,
    });
  }

  /**
   * Доменные правила Def: субъекта не знают — проверяются для любого
   * вызывающего. Отказ — до UoW: следов не остаётся.
   */
  protected checkRules(loaded: L & F): Result<void, UseCaseErrorOf<D>> {
    for (const r of this.rules) {
      const checked = r.check(loaded);
      if (!checked.ok) return checked;
    }
    return ok();
  }

  /**
   * Выход по схеме Def — до фиксации: невалидный ответ — баг реализации, и
   * тогда операция не оставляет следов (клиент может безопасно повторить).
   */
  protected parseOutput(
    raw: RawOutputOf<D>,
  ): Result<OutputOf<D>, UseCaseErrorOf<D>> {
    const output = v.safeParse(this.def.output, raw);
    if (!output.success) {
      return CoreErrors.OUTPUT_VALIDATION.err({ issues: issues(output) });
    }
    return ok(output.output);
  }

  private async run(
    input: unknown,
    caller: Caller<U>,
    trace: Trace,
    run: OperationRun,
  ): Promise<Result<OutputOf<D>, UseCaseErrorOf<D>>> {
    const allowed = this.checkCaller(caller);
    if (!allowed.ok) return allowed;
    const parsed = this.parseInput(input);
    if (!parsed.ok) return parsed;
    const loaded = await this.load(parsed.value, caller, trace);
    if (!loaded.ok) return loaded;
    const permitted = this.checkPolicy(loaded.value, caller);
    if (!permitted.ok) return permitted;
    const fetched = await this.fetch(parsed.value, loaded.value, caller, trace);
    if (!fetched.ok) return fetched;
    const context = merge(loaded.value, fetched.value);
    const checked = this.checkRules(context);
    if (!checked.ok) return checked;
    const uow = run.track(this.createUow(trace));
    const res = await this.execute(parsed.value, context, uow, caller, trace);
    if (!res.ok) return res;
    const output = this.parseOutput(res.value);
    if (!output.ok) return output;
    const committed = await uow.commit();
    if (!committed.ok) return committed;
    return output;
  }
}

/**
 * Контекст правил и `execute`: загруженное, дополненное добытым `fetch`.
 * Оба — записи (контекст Policy и ответы зависимостей), поэтому
 * поверхностная склейка; общее поле берётся из `fetch`.
 */
function merge<L, F>(loaded: L, fetched: F): L & F {
  if (fetched === undefined) return loaded as L & F;
  return Object.assign({}, loaded, fetched);
}

type Issue = { readonly path: string; readonly message: string };

function issues(failure: {
  readonly issues: readonly v.BaseIssue<unknown>[];
}): Issue[] {
  return failure.issues.map((issue) => ({
    path: v.getDotPath(issue) ?? '',
    message: issue.message,
  }));
}
