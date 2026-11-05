import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { beijingParts } from "../../shared/beijing-time.js";
import { appendAudit } from "../audit/audit.repository.js";
import type { ReminderService } from "../reminders/reminder.service.js";
import { SettingService, scheduleSettingsSchema } from "../settings/setting.service.js";
import { AdministrationError, type AdministrationRepository } from "../users/user.service.js";

const dayMs = 24 * 60 * 60 * 1000;
const querySchema = z.object({
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  departmentId: z.string().min(1).max(191).optional(), employeeId: z.string().min(1).max(191).optional()
}).strict();
const exemptionsSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)).max(7), dates: z.array(z.iso.date()).max(3660)
}).strict();
const reminderSchema = z.object({
  employeeId: z.string().min(1).max(191), workDate: z.iso.date(), kind: z.enum(["SUBMISSION", "APPROVAL"])
}).strict();

// Explicit projections prevent HR queries from loading business content or full personnel records.
const employeeSelect = {
  id: true, displayName: true, departmentId: true, department: { select: { name: true } },
  createdAt: true, hireDate: true, departureDate: true, employmentStatus: true
} as const;
const statusSelect = {
  id: true, employeeId: true, workDate: true, status: true, submissionCount: true, submittedAt: true,
  approvalSteps: { select: {
    submissionNumber: true, position: true, status: true, approverId: true,
    approver: { select: { displayName: true } }
  }, orderBy: { position: "asc" as const } }
} as const;

export interface HrStatusRow {
  employeeId: string;
  displayName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  workDate: string;
  logId: string | null;
  expected: boolean;
  submissionStatus: "SUBMITTED" | "MISSING" | "OVERDUE";
  approvalStatus: "PENDING" | "APPROVED" | "RETURNED" | null;
  currentApproverId: string | null;
  currentApproverName: string | null;
  approvalOverdue: boolean;
}

function dateValue(value: Date) { return value.toISOString().slice(0, 10); }
function addDays(value: string, count: number) { return dateValue(new Date(new Date(value).getTime() + count * dayMs)); }

export class HrService {
  private readonly settings: SettingService;

  constructor(
    private readonly database: PrismaClient,
    private readonly administration: AdministrationRepository,
    private readonly reminders: ReminderService,
    private readonly now: () => Date = () => new Date()
  ) {
    this.settings = new SettingService(administration);
  }

  async status(input: unknown = {}) {
    const query = querySchema.parse(input);
    const now = this.now();
    const today = beijingParts(now).date;
    const weekday = new Date(today).getUTCDay();
    const from = query.from ?? addDays(today, -((weekday + 6) % 7));
    const to = query.to ?? today;
    if (from > to || new Date(to).getTime() - new Date(from).getTime() >= 366 * dayMs) {
      throw new AdministrationError(400, "INVALID_DATE_RANGE", "请选择先后顺序正确且不超过 366 天的日期范围");
    }
    const [settings, activation, employees, departments] = await Promise.all([
      this.settings.get(),
      this.database.systemSetting.findUnique({ where: { key: "employee-archives.enabled-at" }, select: { value: true } }),
      this.database.user.findMany({
        where: { role: "EMPLOYEE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null,
          ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...(query.employeeId ? { id: query.employeeId } : {}) },
        select: employeeSelect, orderBy: [{ displayName: "asc" }, { id: "asc" }]
      }),
      this.database.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    ]);
    const activatedAt = typeof activation?.value === "string" && Number.isFinite(Date.parse(activation.value))
      ? new Date(activation.value) : now;
    const logs = employees.length === 0 ? [] : await this.database.dailyLog.findMany({
      where: { employeeId: { in: employees.map((employee) => employee.id) }, workDate: { gte: new Date(from), lte: new Date(to < today ? to : today) } },
      select: statusSelect
    });
    const byEmployeeDate = new Map(logs.map((log) => [`${log.employeeId}:${dateValue(log.workDate)}`, log]));
    const rows: HrStatusRow[] = [];
    let approvalRequired = 0;
    let finalApproved = 0;
    for (const employee of employees) {
      const start = employee.hireDate ? dateValue(employee.hireDate)
        : beijingParts(new Date(Math.max(employee.createdAt.getTime(), activatedAt.getTime()))).date;
      const end = employee.departureDate ? dateValue(employee.departureDate) : null;
      for (let date = from; date <= to && date <= today; date = addDays(date, 1)) {
        const log = byEmployeeDate.get(`${employee.id}:${date}`);
        const submitted = Boolean(log && log.status !== "DRAFT");
        const expected = date >= start && (!end || date < end)
          && !settings.logReminderExcludedDates.includes(date)
          && !settings.logReminderExcludedWeekdays.includes(new Date(date).getUTCDay());
        if (!expected && !submitted) continue;
        const steps = submitted && log ? log.approvalSteps.filter((step) => step.submissionNumber === log.submissionCount && step.status !== "SUPERSEDED") : [];
        const returned = submitted && (log?.status === "RETURNED" || steps.some((step) => step.status === "RETURNED"));
        const complete = submitted && log?.status === "ARCHIVED" && steps.length > 0 && steps.every((step) => step.status === "APPROVED");
        const current = !returned && !complete && (log?.status === "SUBMITTED" || log?.status === "IN_REVIEW")
          ? steps.find((step) => step.status === "PENDING") : undefined;
        if (submitted && log?.approvalSteps.some((step) => step.submissionNumber === log.submissionCount)) approvalRequired++;
        if (complete) finalApproved++;
        rows.push({
          employeeId: employee.id, displayName: employee.displayName, departmentId: employee.departmentId,
          departmentName: employee.department?.name ?? null, workDate: date, logId: log?.id ?? null, expected,
          submissionStatus: submitted ? "SUBMITTED" : now.getTime() >= new Date(`${date}T${settings.submissionDeadline}:00+08:00`).getTime() ? "OVERDUE" : "MISSING",
          approvalStatus: !submitted ? null : returned ? "RETURNED" : complete ? "APPROVED" : "PENDING",
          currentApproverId: current?.approverId ?? null, currentApproverName: current?.approver.displayName ?? null,
          approvalOverdue: Boolean(current && log?.submittedAt && now.getTime() - log.submittedAt.getTime() >= 72 * 60 * 60 * 1000)
        });
      }
    }
    const expected = rows.filter((row) => row.expected).length;
    const submitted = rows.filter((row) => row.expected && row.submissionStatus === "SUBMITTED").length;
    return {
      from, to, rows,
      summary: { expected, submitted, finalApproved,
        overduePeople: new Set(rows.filter((row) => row.submissionStatus === "OVERDUE").map((row) => row.employeeId)).size,
        submissionRate: expected === 0 ? null : submitted / expected,
        approvalCompletionRate: approvalRequired === 0 ? null : finalApproved / approvalRequired },
      employees: employees.map(({ id, displayName, departmentId }) => ({ id, displayName, departmentId })), departments
    };
  }

  async exemptions() {
    const settings = await this.settings.get();
    return { weekdays: settings.logReminderExcludedWeekdays, dates: settings.logReminderExcludedDates };
  }

  async updateExemptions(actorId: string, input: unknown) {
    const parsed = exemptionsSchema.parse(input);
    const result = { weekdays: [...new Set(parsed.weekdays)].sort(), dates: [...new Set(parsed.dates)].sort() };
    const patch = { logReminderExcludedWeekdays: result.weekdays, logReminderExcludedDates: result.dates };
    const defaults = { ...await this.settings.get(), ...patch };
    scheduleSettingsSchema.parse(defaults);
    await this.database.$transaction(async (transaction) => {
      // Merge in PostgreSQL so concurrent changes to other schedule fields survive.
      await transaction.$executeRaw`INSERT INTO system_settings (key, value, updated_by_id, updated_at)
        VALUES ('worklog.schedule', ${JSON.stringify(defaults)}::jsonb, ${actorId}, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = system_settings.value || ${JSON.stringify(patch)}::jsonb,
          updated_by_id = ${actorId}, updated_at = CURRENT_TIMESTAMP`;
      await appendAudit(transaction, { actorId, action: "HR_EXEMPTIONS_CHANGED", entityType: "SystemSetting", entityId: "worklog.schedule", metadata: result });
    });
    return result;
  }

  async remind(actorId: string, input: unknown) {
    const parsed = reminderSchema.parse(input);
    const result = await this.status({ from: parsed.workDate, to: parsed.workDate, employeeId: parsed.employeeId });
    const row = result.rows.find((candidate) => candidate.employeeId === parsed.employeeId);
    if (!row || (parsed.kind === "SUBMISSION" ? !row.expected || row.submissionStatus === "SUBMITTED" : !row.approvalOverdue || !row.currentApproverId)) {
      throw new AdministrationError(409, "REMINDER_NOT_APPLICABLE", "当前状态无需催办，请刷新后重试");
    }
    if (parsed.kind === "SUBMISSION") {
      const employee = await this.database.user.findFirst({ where: { id: parsed.employeeId, role: "EMPLOYEE", employmentStatus: "ACTIVE", accountStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, select: { id: true } });
      if (!employee) throw new AdministrationError(409, "REMINDER_NOT_APPLICABLE", "该员工当前无法提交日志");
    }
    const at = this.now();
    const recipientId = parsed.kind === "SUBMISSION" ? parsed.employeeId : row.currentApproverId!;
    await this.reminders.create({ recipientId,
      kind: parsed.kind === "SUBMISSION" ? "LOG_DUE" : "APPROVAL_OVERDUE",
      deduplicationKey: `hr:${parsed.kind}:${parsed.employeeId}:${parsed.workDate}:${beijingParts(at).date}`,
      title: parsed.kind === "SUBMISSION" ? "人事催交工作日志" : "人事催办日志审批",
      body: parsed.kind === "SUBMISSION" ? `请提交 ${parsed.workDate} 的工作日志。` : `您有 ${parsed.workDate} 的日志审批已等待满 72 小时，请及时处理。`,
      relatedLogId: parsed.kind === "APPROVAL" ? row.logId : null
    });
    await this.administration.appendAudit({ actorId, subjectUserId: recipientId, action: "HR_REMINDER_SENT", entityType: "User", entityId: recipientId,
      metadata: { employeeId: parsed.employeeId, workDate: parsed.workDate, kind: parsed.kind, recipientId, at: at.toISOString() } });
    return { sent: true };
  }
}

function csvCell(value: string | number | boolean | null) {
  const text = value === null ? "" : String(value);
  const safe = /^[\s]*[=+\-@\t\r\n]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function hrStatusCsv(result: Awaited<ReturnType<HrService["status"]>>) {
  const headers = ["姓名", "部门", "工作日期", "应交", "提交状态", "审批状态", "当前审批人", "审批满72小时"];
  const values = result.rows.map((row) => [row.displayName, row.departmentName, row.workDate, row.expected,
    row.submissionStatus, row.approvalStatus, row.currentApproverName, row.approvalOverdue]);
  return "\uFEFF" + [headers, ...values].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
