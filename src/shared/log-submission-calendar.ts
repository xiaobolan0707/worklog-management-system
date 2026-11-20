import { beijingParts } from "./beijing-time.js";

export interface SubmissionCalendar {
  today: string;
  activatedAt: Date;
  excludedDates: readonly string[];
  excludedWeekdays: readonly number[];
}

export function submissionCalendar(now: Date, activation: unknown, settings: {
  logReminderExcludedDates: readonly string[];
  logReminderExcludedWeekdays: readonly number[];
}): SubmissionCalendar {
  return {
    today: beijingParts(now).date,
    activatedAt: typeof activation === "string" && Number.isFinite(Date.parse(activation)) ? new Date(activation) : now,
    excludedDates: settings.logReminderExcludedDates,
    excludedWeekdays: settings.logReminderExcludedWeekdays
  };
}

export function expectsLog(date: string, employee: { createdAt: Date; hireDate: Date | null; departureDate: Date | null }, calendar: SubmissionCalendar) {
  const start = employee.hireDate?.toISOString().slice(0, 10)
    ?? beijingParts(new Date(Math.max(employee.createdAt.getTime(), calendar.activatedAt.getTime()))).date;
  const end = employee.departureDate?.toISOString().slice(0, 10);
  return date <= calendar.today && date >= start && (!end || date < end)
    && !calendar.excludedDates.includes(date) && !calendar.excludedWeekdays.includes(new Date(date).getUTCDay());
}

export function isSubmittedLog(status: string | undefined) {
  return status !== undefined && status !== "DRAFT";
}
