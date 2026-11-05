import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { appendAudit } from "../audit/audit.repository.js";
import { beijingParts } from "../../shared/beijing-time.js";
import { lockPersonnelTransition } from "../../shared/personnel-lock.js";

const DAY = 86_400_000;
const staffRoles = ["EMPLOYEE", "LEADER", "MANAGEMENT"] as const;
const activationKey = "employee-archives.enabled-at";
export type PersonnelActor = { id: string; role: string };
export type PersonnelUpdate = {
  hireDate: string | null;
  departureDate: string | null;
  employmentStatus: "ACTIVE" | "DEPARTED";
  handoverManagerId?: string | undefined;
};

export class PersonnelError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) { super(message); }
}

function requireRole(actor: PersonnelActor, role: "HR" | "MANAGEMENT") {
  if (actor.role !== role) throw new PersonnelError("FORBIDDEN", "无权执行该操作", 403);
}

/** Calendar months use Beijing dates; departure times are instants, not date-only values. */
export function addCalendarMonths(value: Date, count: number): Date {
  const local = new Date(value.getTime() + 8 * 3_600_000);
  const day = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + count);
  const last = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(day, last));
  return new Date(local.getTime() - 8 * 3_600_000);
}

function parseDate(value: string | null) {
  if (value === null) return null;
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new PersonnelError("INVALID_DATE", "请填写有效日期");
  }
  return result;
}

const identityFields = new Set(["id", "userId", "employeeId", "approverId", "authorId", "createdById", "username", "userName", "displayName", "employeeName", "approverName", "authorName", "name"]);
const snapshotContentFields = new Set(["content", "unfinishedReason", "images", "dataUrl", "dataUri"]);
function redactSnapshot(value: Prisma.JsonValue, tokens: string[], field = ""): Prisma.JsonValue {
  if (typeof value === "string") return identityFields.has(field) && tokens.includes(value) ? "[已清除]" : value;
  if (Array.isArray(value)) return value.map((entry) => redactSnapshot(entry, tokens, field));
  if (value && typeof value === "object") {
    const identifiesUser = Object.entries(value).some(([key, entry]) => identityFields.has(key) && key !== "name" && typeof entry === "string" && tokens.includes(entry));
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      snapshotContentFields.has(key) || (key === "name" && !identifiesUser) ? entry : redactSnapshot(entry!, tokens, key)
    ]));
  }
  return value;
}

const personnelSelect = {
  id: true, displayName: true, role: true, departmentId: true,
  department: { select: { name: true } }, employeeNumber: true, numberDepartmentId: true,
  hireDate: true, departureDate: true, employmentStatus: true, createdAt: true,
  departureMarkedAt: true, loginDisabledAt: true, recycleAt: true, recycledAt: true,
  purgeAt: true, restoredAt: true, archivePurgingAt: true
} as const;
type PersonnelRow = Prisma.UserGetPayload<{ select: typeof personnelSelect }>;

function publicPersonnel(user: PersonnelRow, activation: Date | null) {
  const { department, createdAt, hireDate, departureDate, ...rest } = user;
  return {
    ...rest, departmentName: department?.name ?? null,
    hireDate: hireDate?.toISOString().slice(0, 10) ?? null,
    departureDate: departureDate?.toISOString().slice(0, 10) ?? null,
    archiveDeadline: new Date(Math.max(createdAt.getTime(), activation?.getTime() ?? 0) + 7 * DAY).toISOString()
  };
}

export class PersonnelService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: { remove(key: string): Promise<void> },
    private readonly now: () => Date = () => new Date()
  ) {}

  private async activation() {
    const setting = await this.database.systemSetting.findUnique({ where: { key: activationKey }, select: { value: true } });
    const time = typeof setting?.value === "string" ? new Date(setting.value) : null;
    return time && Number.isFinite(time.getTime()) ? time : null;
  }

  private async employee(id: string) {
    const row = await this.database.user.findFirst({
      where: { id, archivePurgingAt: null, archivePurgedAt: null }, select: personnelSelect
    });
    if (!row) throw new PersonnelError("NOT_FOUND", "未找到员工", 404);
    return publicPersonnel(row, await this.activation());
  }

  async list(actor: PersonnelActor) {
    requireRole(actor, "HR");
    const [employees, departments, managers, activation] = await Promise.all([
      this.database.user.findMany({
        where: { deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null, role: { in: [...staffRoles] } },
        select: personnelSelect, orderBy: [{ departmentId: "asc" }, { createdAt: "asc" }]
      }),
      this.database.department.findMany({ select: { id: true, name: true, employeeNumberPrefix: true }, orderBy: { name: "asc" } }),
      this.database.user.findMany({
        where: { role: "MANAGEMENT", employmentStatus: "ACTIVE", accountStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        select: { id: true, displayName: true }
      }),
      this.activation()
    ]);
    return { employees: employees.map((row) => publicPersonnel(row, activation)), departments, managers };
  }

  async update(actor: PersonnelActor, id: string, input: PersonnelUpdate) {
    requireRole(actor, "HR");
    const hireDate = parseDate(input.hireDate);
    const departureDate = parseDate(input.departureDate);
    if (!["ACTIVE", "DEPARTED"].includes(input.employmentStatus)) throw new PersonnelError("INVALID_STATUS", "任职状态无效");
    if (hireDate && departureDate && hireDate > departureDate) throw new PersonnelError("INVALID_DATE_RANGE", "离职日期不能早于入职日期");
    if (input.employmentStatus === "DEPARTED" && !departureDate) throw new PersonnelError("DEPARTURE_DATE_REQUIRED", "请填写离职日期");
    await this.database.$transaction(async (tx) => {
      await lockPersonnelTransition(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id, deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null, role: { in: [...staffRoles] } },
        select: { id: true, employmentStatus: true }
      });
      if (!user) throw new PersonnelError("NOT_FOUND", "未找到员工", 404);
      if (user.employmentStatus === "DEPARTED" && input.employmentStatus === "ACTIVE") {
        throw new PersonnelError("REEMPLOYMENT_UNSUPPORTED", "本功能仅维护任职与离职；不支持复职", 409);
      }
      const departing = user.employmentStatus === "ACTIVE" && input.employmentStatus === "DEPARTED";
      if (departing) await this.handover(tx, actor, id, input.handoverManagerId);
      const now = this.now();
      await tx.user.update({ where: { id }, data: {
        hireDate, departureDate, employmentStatus: input.employmentStatus,
        ...(departing ? { departureMarkedAt: now, recycleAt: addCalendarMonths(now, 6) } : {})
      } });
      await appendAudit(tx, { actorId: actor.id, subjectUserId: id, action: departing ? "PERSONNEL_DEPARTED" : "PERSONNEL_UPDATED", entityType: "User", entityId: id, metadata: { employmentStatus: input.employmentStatus } });
    });
    return this.employee(id);
  }

  private async handover(tx: Prisma.TransactionClient, actor: PersonnelActor, id: string, managerId?: string) {
    const [steps, assignments] = await Promise.all([
      tx.approvalStep.findMany({ where: { approverId: id, status: "PENDING" }, select: { id: true, dailyLogId: true, submissionNumber: true, position: true } }),
      tx.employeeApprover.findMany({ where: { approverId: id, active: true }, select: { id: true, employeeId: true, position: true } })
    ]);
    if (!steps.length && !assignments.length) return;
    if (!managerId || managerId === id) throw new PersonnelError("HANDOVER_REQUIRED", "请选择管理层接手未完成审批及未来审批配置", 409);
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${managerId} FOR UPDATE`;
    const manager = await tx.user.findFirst({ where: { id: managerId, role: "MANAGEMENT", employmentStatus: "ACTIVE", accountStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, select: { id: true } });
    if (!manager) throw new PersonnelError("INVALID_HANDOVER_MANAGER", "接手人必须是在职且可用的管理层账号");
    // A manager may hold multiple pending positions; every position still requires its own action.
    await tx.approvalStep.updateMany({ where: { approverId: id, status: "PENDING" }, data: { approverId: managerId } });
    for (const assignment of assignments) {
      const existing = await tx.employeeApprover.findUnique({ where: { employeeId_approverId: { employeeId: assignment.employeeId, approverId: managerId } }, select: { id: true, active: true } });
      if (existing) {
        await tx.employeeApprover.update({ where: { id: existing.id }, data: { active: true } });
        await tx.employeeApprover.delete({ where: { id: assignment.id } });
        const remaining = await tx.employeeApprover.findMany({ where: { employeeId: assignment.employeeId }, orderBy: { position: "asc" }, select: { id: true, position: true } });
        // Lowering in ascending order is collision-free after removing the duplicate position.
        for (const [index, entry] of remaining.entries()) {
          if (entry.position !== index + 1) await tx.employeeApprover.update({ where: { id: entry.id }, data: { position: index + 1 } });
        }
      } else {
        await tx.employeeApprover.update({ where: { id: assignment.id }, data: { approverId: managerId } });
      }
    }
    await appendAudit(tx, { actorId: actor.id, subjectUserId: id, action: "APPROVAL_HANDOVER", entityType: "User", entityId: id,
      metadata: { managerId, pendingSteps: steps, futureAssignments: assignments } });
  }

  async allocateNumber(actor: PersonnelActor, id: string) {
    requireRole(actor, "HR");
    await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id, deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null, role: { in: [...staffRoles] } },
        select: { id: true, departmentId: true, employeeNumber: true, employmentStatus: true }
      });
      if (!user) throw new PersonnelError("NOT_FOUND", "未找到员工", 404);
      if (user.employeeNumber !== null) return;
      if (user.employmentStatus !== "ACTIVE") throw new PersonnelError("EMPLOYEE_DEPARTED", "离职人员不能分配新工号", 409);
      if (!user.departmentId) throw new PersonnelError("DEPARTMENT_REQUIRED", "请先确定员工所属部门");
      const sequence = await tx.department.update({ where: { id: user.departmentId }, data: { nextEmployeeNumber: { increment: 1 } }, select: { nextEmployeeNumber: true } });
      await tx.user.update({ where: { id }, data: { employeeNumber: sequence.nextEmployeeNumber, numberDepartmentId: user.departmentId } });
      await appendAudit(tx, { actorId: actor.id, subjectUserId: id, action: "EMPLOYEE_NUMBER_ALLOCATED", entityType: "User", entityId: id, metadata: {} });
    });
    return this.employee(id);
  }

  async listRecycleBin(actor: PersonnelActor) {
    requireRole(actor, "MANAGEMENT");
    const rows = await this.database.user.findMany({ where: { recycledAt: { not: null }, archivePurgedAt: null }, select: personnelSelect, orderBy: { recycledAt: "desc" } });
    const activation = await this.activation();
    return { employees: rows.map((row) => publicPersonnel(row, activation)) };
  }

  async restore(actor: PersonnelActor, id: string) {
    requireRole(actor, "MANAGEMENT");
    const now = this.now();
    await this.database.$transaction(async (tx) => {
      await lockPersonnelTransition(tx);
      const changed = await tx.user.updateMany({
        where: { id, recycledAt: { not: null }, archivePurgingAt: null, archivePurgedAt: null },
        data: { deletedAt: null, recycledAt: null, purgeAt: null, restoredAt: now, accountStatus: "DISABLED", loginDisabledAt: now }
      });
      if (changed.count !== 1) throw new PersonnelError("RECYCLE_CONFLICT", "资料已恢复或已开始清除，不能恢复", 409);
      await tx.session.deleteMany({ where: { userId: id } });
      await appendAudit(tx, { actorId: actor.id, subjectUserId: id, action: "ARCHIVE_RESTORED", entityType: "User", entityId: id, metadata: {} });
    });
    return this.employee(id);
  }

  async purge(actor: PersonnelActor, id: string) {
    requireRole(actor, "MANAGEMENT");
    return this.purgeArchive(id, this.now(), actor.id);
  }

  private async purgeArchive(id: string, now: Date, actorId?: string) {
    await this.database.$transaction(async (tx) => {
      await lockPersonnelTransition(tx);
      const user = await tx.user.findUnique({ where: { id }, select: { id: true, recycledAt: true, archivePurgedAt: true, archivePurgingAt: true } });
      if (!user?.recycledAt || user.archivePurgedAt) throw new PersonnelError("RECYCLE_CONFLICT", "资料不在回收站或已清除", 409);
      if (!user.archivePurgingAt) {
        const claimed = await tx.user.updateMany({ where: { id, recycledAt: { not: null }, archivePurgingAt: null, archivePurgedAt: null }, data: { archivePurgingAt: now } });
        if (claimed.count !== 1) throw new PersonnelError("RECYCLE_CONFLICT", "资料状态已变化，请重试", 409);
      }
    });
    const attachments = await this.database.employeeAttachment.findMany({ where: { userId: id }, select: { id: true, storageKey: true } });
    // A failed remove leaves the claim in place; idempotent storage.remove makes the next run retryable.
    for (const file of attachments) await this.storage.remove(file.storageKey);
    await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      const target = await tx.user.findFirst({ where: { id, archivePurgingAt: { not: null }, archivePurgedAt: null }, select: { username: true, displayName: true } });
      if (!target) return;
      await this.clearPrivateData(tx, id, target.username, target.displayName?.trim() || null, attachments.flatMap((file) => [file.id, file.storageKey]));
      await tx.user.update({ where: { id }, data: {
        username: `purged-${createHash("sha256").update(id).digest("hex").slice(0, 40)}`,
        passwordHash: randomUUID(), displayName: "已清除员工", gender: null, departmentId: null,
        hireDate: null, departureDate: null, employeeNumber: null, numberDepartmentId: null,
        employmentStatus: "DEPARTED", accountStatus: "DISABLED", mustChangePassword: false,
        lockedUntil: null, failedLoginCount: 0, deletedAt: now, archivePurgedAt: now,
        departureMarkedAt: null, recycleAt: null, recycledAt: null, purgeAt: null, restoredAt: null
      } });
      await appendAudit(tx, { actorId: actorId ?? null, action: "ARCHIVE_PURGED", entityType: "Archive", entityId: id, metadata: {} });
    }, { timeout: 60_000 });
  }

  private async clearPrivateData(tx: Prisma.TransactionClient, id: string, username: string, displayName: string | null, storageKeys: string[]) {
    const ownedLogs = { employeeId: id };
    const logs = await tx.dailyLog.findMany({ where: ownedLogs, select: { id: true, approvalSteps: { select: { id: true, replies: { select: { id: true } } } } } });
    const contentIds = logs.flatMap((log) => [log.id, ...log.approvalSteps.flatMap((step) => [step.id, ...step.replies.map((reply) => reply.id)])]);
    // ColorChange uses RESTRICT, while log versions, items, approvals and replies cascade.
    await tx.colorChange.deleteMany({ where: { dailyLog: ownedLogs } });
    await tx.dailyLog.deleteMany({ where: ownedLogs });
    // Replies on other employees' logs belong to those employees, not to this approver.
    await tx.approvalStep.updateMany({ where: { approverId: id }, data: { comment: null, itemComments: Prisma.DbNull } });
    await tx.colorChange.updateMany({ where: { changedById: id }, data: { reason: "已清除" } });
    const snapshots = await tx.$queryRaw<{ id: string; snapshot: Prisma.JsonValue }[]>`SELECT id, snapshot FROM log_versions WHERE position(${id} in snapshot::text) > 0 OR position(${username} in snapshot::text) > 0 OR (${displayName}::text IS NOT NULL AND position(${displayName} in snapshot::text) > 0)`;
    for (const version of snapshots) {
      const snapshot = redactSnapshot(version.snapshot, [id, username, ...(displayName ? [displayName] : [])]);
      await tx.logVersion.update({ where: { id: version.id }, data: { snapshot: snapshot === null ? Prisma.JsonNull : snapshot } });
    }
    await tx.employeeApprover.deleteMany({ where: { OR: [{ employeeId: id }, { approverId: id }] } });
    await tx.employeeAttachment.deleteMany({ where: { userId: id } });
    await tx.rewardDecision.deleteMany({ where: { employeeId: id } });
    await tx.rewardDecision.updateMany({ where: { decidedById: id }, data: { note: null } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.loginAttempt.deleteMany({ where: { OR: [{ userId: id }, { username }] } });
    await tx.systemSetting.updateMany({ where: { updatedById: id }, data: { updatedById: null } });
    await tx.reminder.deleteMany({ where: { OR: [{ recipientId: id }, { deduplicationKey: { contains: id } }, { body: { contains: username } }, ...(displayName ? [{ body: { contains: displayName } }] : [])] } });
    await tx.$executeRaw`SET LOCAL app.archive_purge = 'true'`;
    await tx.auditEvent.deleteMany({ where: { OR: [{ actorId: id }, { subjectUserId: id }, { entityId: { in: [id, ...contentIds, ...storageKeys] } }] } });
    // Match immutable identifiers as JSON values, never field names or non-unique personal names.
    for (const identifier of new Set([id, ...storageKeys, ...contentIds])) {
      await tx.$executeRaw`DELETE FROM audit_events WHERE jsonb_path_exists(metadata,
        '$.** ? (@ == $identifier)', jsonb_build_object('identifier', ${identifier}::text))`;
    }
  }

  async runJobs(now = this.now(), dryRun = false) {
    const disabled = await this.database.user.findMany({ where: { employmentStatus: "DEPARTED", departureMarkedAt: { lte: new Date(now.getTime() - 30 * DAY) }, loginDisabledAt: null, archivePurgedAt: null }, select: { id: true } });
    const recycled = await this.database.user.findMany({ where: { employmentStatus: "DEPARTED", recycleAt: { lte: now }, recycledAt: null, restoredAt: null, archivePurgedAt: null }, select: { id: true } });
    const purged = await this.database.user.findMany({ where: { recycledAt: { not: null }, archivePurgedAt: null, OR: [{ purgeAt: { lte: now } }, { archivePurgingAt: { not: null } }] }, select: { id: true } });
    const pendingFiles = await this.database.employeeAttachment.findMany({ where: { deletedAt: { not: null } }, select: { id: true, storageKey: true } });
    const report = { dryRun, disable: disabled.map((row) => row.id), recycle: recycled.map((row) => row.id), purge: purged.map((row) => row.id), pendingAttachmentDeletes: pendingFiles.map((file) => file.id), completed: { disabled: 0, recycled: 0, purged: 0, attachmentDeletes: 0 }, reminders: 0, errors: [] as { id: string; message: string }[] };
    if (dryRun) return report;
    for (const employee of disabled) {
      try { await this.database.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({ where: { id: employee.id, loginDisabledAt: null, employmentStatus: "DEPARTED" }, data: { accountStatus: "DISABLED", loginDisabledAt: now } });
        await tx.session.deleteMany({ where: { userId: employee.id } });
        if (changed.count) { await appendAudit(tx, { action: "DEPARTURE_LOGIN_DISABLED", subjectUserId: employee.id, entityType: "User", entityId: employee.id, metadata: {} }); report.completed.disabled++; }
      }); } catch (error) { report.errors.push({ id: employee.id, message: error instanceof Error ? error.message : "禁用失败" }); }
    }
    for (const employee of recycled) {
      try { await this.database.$transaction(async (tx) => {
        await lockPersonnelTransition(tx);
        const changed = await tx.user.updateMany({ where: { id: employee.id, recycledAt: null, restoredAt: null, archivePurgedAt: null }, data: { accountStatus: "DISABLED", loginDisabledAt: now, recycledAt: now, purgeAt: new Date(now.getTime() + 30 * DAY) } });
        if (changed.count) { await tx.session.deleteMany({ where: { userId: employee.id } }); await appendAudit(tx, { action: "ARCHIVE_RECYCLED", subjectUserId: employee.id, entityType: "User", entityId: employee.id, metadata: {} }); report.completed.recycled++; }
      }); } catch (error) { report.errors.push({ id: employee.id, message: error instanceof Error ? error.message : "回收失败" }); }
    }
    for (const employee of purged) {
      try { await this.purgeArchive(employee.id, now); report.completed.purged++; }
      catch (error) { report.errors.push({ id: employee.id, message: error instanceof Error ? error.message : "清除失败" }); }
    }
    for (const file of pendingFiles) {
      try {
        await this.storage.remove(file.storageKey);
        const changed = await this.database.employeeAttachment.deleteMany({ where: { id: file.id, deletedAt: { not: null } } });
        report.completed.attachmentDeletes += changed.count;
      } catch (error) { report.errors.push({ id: file.id, message: error instanceof Error ? error.message : "附件清除失败" }); }
    }
    report.reminders = await this.archiveReminders(now);
    return report;
  }

  private async archiveReminders(now: Date) {
    const current = beijingParts(now);
    const activation = await this.activation();
    if (current.minutes < 9 * 60 || !activation) return 0;
    const employees = await this.database.user.findMany({
      where: { employmentStatus: "ACTIVE", accountStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null, role: { in: [...staffRoles] } },
      select: { id: true, displayName: true, gender: true, departmentId: true, department: { select: { name: true } }, hireDate: true, employeeNumber: true, createdAt: true, archiveAttachments: { where: { deletedAt: null }, select: { category: true } } }
    });
    const recipients = await this.database.user.findMany({
      where: { role: { in: ["HR", "LEADER"] }, employmentStatus: "ACTIVE", accountStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
      select: { id: true, role: true, departmentId: true }
    });
    let total = 0;
    for (const employee of employees) {
      const deadline = Math.max(activation.getTime(), employee.createdAt.getTime()) + 7 * DAY;
      const categories = new Set(employee.archiveAttachments.map((file) => file.category));
      const complete = Boolean(employee.displayName?.trim() && employee.gender?.trim() && employee.departmentId && employee.hireDate && employee.employeeNumber && ["RESUME", "DEGREE", "AGREEMENT"].every((category) => categories.has(category as never)));
      if (complete || now.getTime() < deadline) continue;
      const targets = new Set([employee.id, ...recipients.filter((recipient) => recipient.role === "HR" || (employee.departmentId !== null && recipient.departmentId === employee.departmentId)).map((recipient) => recipient.id)]);
      for (const recipientId of targets) {
        const key = `${employee.id}:${current.date}`;
        await this.database.reminder.upsert({
          where: { recipientId_kind_deduplicationKey: { recipientId, kind: "ARCHIVE_OVERDUE", deduplicationKey: key } }, update: {},
          create: { recipientId, kind: "ARCHIVE_OVERDUE", deduplicationKey: key, title: "员工资料逾期未补齐", body: `${employee.displayName ?? "员工"}｜工号 ${employee.employeeNumber === null ? "未分配" : String(employee.employeeNumber).padStart(4, "0")}｜${employee.department?.name ?? "未分配部门"}：资料逾期未补齐。` }
        });
        total++;
      }
    }
    return total;
  }
}
