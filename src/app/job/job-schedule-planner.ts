import type { JobSchedule } from '#core/domain/contracts/job-def';
import type { Timestamp } from '#core/kernel/time/timestamp';

/**
 * Календарная математика расписаний (D-71): момент следующего запуска строго
 * после указанного. Вход и выход — `Timestamp` (мс UTC); `Date` — только
 * внутри, для календарных полей. Чистый объект без побочных эффектов.
 * @see docs/guides/job.md
 */
export class JobSchedulePlanner {
  /** Ближайший запуск расписания строго после `after`. */
  nextRunAfter(schedule: JobSchedule, after: Timestamp): Timestamp {
    switch (schedule.kind) {
      case 'interval':
        return this.nextInterval(schedule, after);
      case 'dailyAt':
        return this.nextDailyAt(schedule, after);
      case 'weeklyAt':
        return this.nextWeeklyAt(schedule, after);
      case 'monthlyAt':
        return this.nextMonthlyAt(schedule, after);
    }
  }

  private nextInterval(
    schedule: Extract<JobSchedule, { kind: 'interval' }>,
    after: Timestamp,
  ): Timestamp {
    if (schedule.alignUtc) {
      // Сетка от epoch (UTC-полночь кратна intervalMs): строго следующий узел
      const next = Math.ceil((after + 1) / schedule.intervalMs);
      return next * schedule.intervalMs;
    }
    return after + schedule.intervalMs;
  }

  private nextDailyAt(
    schedule: Extract<JobSchedule, { kind: 'dailyAt' }>,
    after: Timestamp,
  ): Timestamp {
    const at = new Date(after);
    let candidate = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      schedule.hour,
      schedule.minute,
    );
    if (candidate <= after) {
      candidate += 24 * 3_600_000;
    }
    return candidate;
  }

  private nextWeeklyAt(
    schedule: Extract<JobSchedule, { kind: 'weeklyAt' }>,
    after: Timestamp,
  ): Timestamp {
    const at = new Date(after);
    const daysAhead = (schedule.weekday - at.getUTCDay() + 7) % 7;
    let candidate = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate() + daysAhead,
      schedule.hour,
      schedule.minute,
    );
    if (candidate <= after) {
      candidate += 7 * 24 * 3_600_000;
    }
    return candidate;
  }

  private nextMonthlyAt(
    schedule: Extract<JobSchedule, { kind: 'monthlyAt' }>,
    after: Timestamp,
  ): Timestamp {
    const at = new Date(after);
    const year = at.getUTCFullYear();
    const month = at.getUTCMonth();
    let candidate = Date.UTC(
      year,
      month,
      this.clampDay(year, month, schedule.day),
      schedule.hour,
      schedule.minute,
    );
    if (candidate <= after) {
      // Следующий месяц (Date.UTC нормализует декабрь → январь следующего года)
      const nextYear = month === 11 ? year + 1 : year;
      const nextMonth = (month + 1) % 12;
      candidate = Date.UTC(
        nextYear,
        nextMonth,
        this.clampDay(nextYear, nextMonth, schedule.day),
        schedule.hour,
        schedule.minute,
      );
    }
    return candidate;
  }

  /** День месяца, клампнутый на последний день месяца (семантика cron). */
  private clampDay(year: number, month: number, day: number): number {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Math.min(day, lastDay);
  }
}
