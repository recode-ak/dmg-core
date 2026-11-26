/** Найденное расхождение копии с пакетом */
export interface Finding {
  path: string;
  message: string;
}

/** Итог сверки проекта с пакетом (пути от корня проекта) */
export interface Inspection {
  /** Копии, которые надо записать (нет или расходится) */
  write: string[];
  /** Свои копии без источника — файлы и каталоги скилов */
  stale: string[];
  /** Файлы проекта на месте копий — не трогаются */
  foreign: string[];
  /** Битые ссылки `roles.refs` — `sync` отказывает до записи */
  broken: Finding[];
  /** Все находки, в том числе `broken` */
  findings: Finding[];
}
