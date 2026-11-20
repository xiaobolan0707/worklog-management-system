import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { expectsLog, isSubmittedLog, submissionCalendar, type SubmissionCalendar } from "../../shared/log-submission-calendar.js";
import type { SettingService } from "../settings/setting.service.js";

const querySchema = z.object({ date: z.iso.date() });

export interface BoardEmployee {
  id: string;
  displayName: string | null;
  username: string;
  employeeNumber: number | null;
  numberDepartmentId: string | null;
  department: { name: string } | null;
  createdAt: Date;
  hireDate: Date | null;
  departureDate: Date | null;
}

export interface BoardLog {
  employeeId: string;
  status: string;
}

export function buildStatusBoard(date: string, employees: BoardEmployee[], logs: BoardLog[], calendar: SubmissionCalendar,
  numberDepartments: ReadonlyMap<string, { name: string; employeeNumberPrefix: string | null }> = new Map()) {
  const byEmployee = new Map(logs.map((log) => [log.employeeId, log]));
  const rows = (date <= calendar.today ? employees : []).flatMap((employee) => {
    const log = byEmployee.get(employee.id);
    const submitted = isSubmittedLog(log?.status);
    const expected = expectsLog(date, employee, calendar);
    if (!expected && !submitted) return [];
    const assigned = employee.numberDepartmentId ? numberDepartments.get(employee.numberDepartmentId) : undefined;
    const prefix = assigned?.employeeNumberPrefix || `${assigned?.name ?? "原部门"} `;
    const number = employee.employeeNumber == null
      ? "待补录"
      : `${prefix}${String(employee.employeeNumber).padStart(4, "0")}`;
    return {
      employeeId: employee.id,
      employeeName: employee.displayName ?? employee.username,
      employeeNumber: number,
      departmentName: employee.department?.name ?? "未分配",
      expected,
      status: log?.status ?? "MISSING",
      completed: submitted,
      archived: log?.status === "ARCHIVED"
    };
  });
  return {
    date,
    summary: {
      employees: rows.length,
      expected: rows.filter((row) => row.expected).length,
      completed: rows.filter((row) => row.expected && row.completed).length,
      missing: rows.filter((row) => row.expected && !row.completed).length,
      archived: rows.filter((row) => row.archived).length
    },
    rows
  };
}

/**
 * 只读聚合，所有登录用户可查看全公司当日提交与归档情况（对齐正式版「全员状态」看板）。
 * 离职账号由 authenticate 插件拦截：GET 只放行 me/profile/logs/mine/reminders 等白名单，
 * /api/status/board 不在白名单内，直接访问会被 403。
 */
export const statusRoutes: FastifyPluginAsync<{ database: PrismaClient; settings: Pick<SettingService, "get">; now?: (() => Date) | undefined }> = async (app, options) => {
  app.get("/api/status/board", { preHandler: app.requireUser }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查查询日期" });
    }
    const date = parsed.data.date;
    const workDate = new Date(`${date}T00:00:00.000Z`);

    const [employees, settings, activation, departments] = await Promise.all([
      options.database.user.findMany({
        where: { role: "EMPLOYEE", accountStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        select: {
          id: true, displayName: true, username: true, employeeNumber: true, numberDepartmentId: true,
          createdAt: true, hireDate: true, departureDate: true, department: { select: { name: true } }
        },
        orderBy: [{ username: "asc" }]
      }),
      options.settings.get(),
      options.database.systemSetting.findUnique({ where: { key: "employee-archives.enabled-at" }, select: { value: true } }),
      options.database.department.findMany({ select: { id: true, name: true, employeeNumberPrefix: true } })
    ]);

    const logs = await options.database.dailyLog.findMany({
      where: { workDate, employeeId: { in: employees.map((employee) => employee.id) } },
      select: { employeeId: true, status: true }
    });

    const calendar = submissionCalendar(options.now?.() ?? new Date(), activation?.value, settings);
    return { board: buildStatusBoard(date, employees, logs, calendar, new Map(departments.map((department) => [department.id, department]))) };
  });
};
