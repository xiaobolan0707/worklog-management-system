import type { PrismaClient } from "../../generated/prisma/client.js";
import { beijingParts, clockMinutes } from "../../shared/beijing-time.js";
import type { ScheduleSettings } from "../users/user.service.js";

export type PeriodType = "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface StatRow {
  color: "RED" | "GRAY" | null;
  submittedOnTime: boolean;
  returnCount: number;
}

function isoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function periodRange(type: PeriodType, referenceDate: string) {
  const [yearValue, monthValue] = referenceDate.split("-").map(Number);
  const year = yearValue!;
  const month = monthValue! - 1;
  if (type === "YEARLY") {
    return { start: isoDate(year, 0, 1), end: isoDate(year, 11, 31) };
  }
  const startMonth = type === "QUARTERLY" ? Math.floor(month / 3) * 3 : month;
  const months = type === "QUARTERLY" ? 3 : 1;
  return {
    start: isoDate(year, startMonth, 1),
    end: isoDate(year, startMonth + months, 0)
  };
}

export function buildPeriodStats(rows: StatRow[]) {
  const redCount = rows.filter((row) => row.color === "RED").length;
  const grayCount = rows.filter((row) => row.color === "GRAY").length;
  const decided = redCount + grayCount;
  return {
    total: rows.length,
    redCount,
    grayCount,
    returnCount: rows.reduce((sum, row) => sum + row.returnCount, 0),
    onTimeRate: rows.length === 0
      ? 0
      : Math.round((rows.filter((row) => row.submittedOnTime).length / rows.length) * 100),
    completionRate: decided === 0 ? 0 : Math.round((redCount / decided) * 100)
  };
}

export interface ReportRepository {
  listStats(employeeIds: string[] | null, start: string, end: string): Promise<StatRow[]>;
}

export class ReportService {
  constructor(private readonly repository: ReportRepository) {}

  async buildPeriodStats(employeeIds: string[] | null, type: PeriodType, referenceDate: string) {
    const range = periodRange(type, referenceDate);
    return { ...range, ...buildPeriodStats(await this.repository.listStats(employeeIds, range.start, range.end)) };
  }
}

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly database: PrismaClient, private readonly getSettings: () => Promise<ScheduleSettings>) {}

  async listStats(employeeIds: string[] | null, start: string, end: string) {
    const deadline = clockMinutes((await this.getSettings()).submissionDeadline);
    const logs = await this.database.dailyLog.findMany({
      where: {
        ...(employeeIds === null ? {} : { employeeId: { in: employeeIds } }),
        workDate: {
          gte: new Date(`${start}T00:00:00.000Z`),
          lte: new Date(`${end}T00:00:00.000Z`)
        }
      },
      include: {
        approvalSteps: true,
        versions: { select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 1 }
      }
    });
    return logs.map((log) => {
      const firstSubmission = log.versions[0]?.createdAt ?? log.submittedAt;
      const submitted = firstSubmission ? beijingParts(firstSubmission) : null;
      return {
        color: log.status === "ARCHIVED" && log.color !== "GREEN" ? log.color : null,
        submittedOnTime: Boolean(submitted &&
          submitted.date === log.workDate.toISOString().slice(0, 10) && submitted.minutes <= deadline),
        returnCount: log.approvalSteps.filter((step) => step.status === "RETURNED").length
      };
    });
  }
}
