/** Каталоги слоёв фреймворка, абсолютные; `{m}` — имя модуля. Источник — `GenLayout.dirs()`. */
export type FrameworkDirs = {
  readonly kernel: string;
  /** Шаблон с `{m}`; префикс до сегмента с `{m}` — корень домена. */
  readonly domain: string;
  /** Шаблон с `{m}`; при `{m}` = `app` — общее реализаций `backend-app`. */
  readonly backend: string;
  readonly assembly: string;
};

/** Где лежат слои приложения (D-107): проект, слои фреймворка, раннеры, слои поставщиков. */
export type LayerPlaces = {
  /** Корень проекта: файлы обходятся под ним, место в сообщении — путь от него. */
  readonly project: string;
  readonly layout: FrameworkDirs;
  /** Каталоги раннеров-процессов. */
  readonly runners: readonly string[];
  /** Каталоги слоёв поставщиков по имени слоя; у слоя по модулям — шаблоны с `{m}`. */
  readonly layers?: Readonly<Record<string, readonly string[]>>;
  /** Вход модуля для чужого кода; по умолчанию `index`. */
  readonly entry?: string;
  /** Вход фикстур модуля для тестового кода (D-70); по умолчанию `testing`. */
  readonly testing?: string;
};
