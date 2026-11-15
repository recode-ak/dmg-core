import type { AnyAppDef } from '../domain/contracts/app-def';
import { DefIndex } from '../graph/def-index';
import { GraphId } from '../graph/graph-id';
import { TODO_TEXT } from './todo-text';
import { Violation } from './violation';

/**
 * Проверки `AppDef` (D-93): MAN-01 для приложения (тексты) и MAN-15
 * (состав: повтор модуля, забытый модуль из `dependsOn`, имя — сегмент
 * `id` графа). Подключается в `ArchChecker.of`.
 */
export class AppDefChecker {
  constructor(private readonly def: AnyAppDef) {}

  check(): Violation[] {
    return [
      ...this.checkTexts(),
      ...this.checkName(),
      ...this.checkRepeats(),
      ...this.checkClosure(),
    ];
  }

  /** `TODO` в `label` и `description` — предупреждения MAN-01. */
  todos(): Violation[] {
    const out: Violation[] = [];
    for (const [field, text] of this.texts()) {
      const trimmed = text.trim();
      if (!TODO_TEXT.test(trimmed)) continue;
      out.push(
        new Violation(
          'MAN-01',
          `${this.title()}: ${field} не заполнен — «${trimmed}»`,
        ),
      );
    }
    return out;
  }

  private checkTexts(): Violation[] {
    return this.texts()
      .filter(([, text]) => text.trim() === '')
      .map(
        ([field]) =>
          new Violation('MAN-01', `${this.title()}: пустой ${field}`),
      );
  }

  /** Имя приложения станет корнем графа — сегмент `id` (D-92). */
  private checkName(): Violation[] {
    if (GraphId.isSegment(this.def.name)) return [];
    return [
      new Violation('MAN-15', `${this.title()}: имя не сегмент id графа`),
    ];
  }

  /** Модуль в составе дважды — по ссылке или по имени. */
  private checkRepeats(): Violation[] {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const m of this.def.modules) {
      if (seen.has(m.name)) repeated.add(m.name);
      seen.add(m.name);
    }
    return [...repeated].map(
      (name) =>
        new Violation(
          'MAN-15',
          `${this.title()}: модуль ${name} в составе дважды`,
        ),
    );
  }

  /** Не-external модуль из замыкания `dependsOn` обязан входить в состав (по имени). */
  private checkClosure(): Violation[] {
    const out: Violation[] = [];
    const names = new Set(this.def.modules.map((m) => m.name));
    for (const m of DefIndex.from(this.def.modules).modules) {
      for (const dep of m.dependsOn) {
        if (dep.external || names.has(dep.name)) continue;
        out.push(
          new Violation(
            'MAN-15',
            `${this.title()}: модуль ${dep.name} нужен модулю ${m.name} (dependsOn), но не входит в состав`,
          ),
        );
      }
    }
    return out;
  }

  private texts(): (readonly ['label' | 'description', string])[] {
    return [
      ['label', this.def.label],
      ['description', this.def.description],
    ];
  }

  private title(): string {
    return `приложение ${this.def.name}`;
  }
}
