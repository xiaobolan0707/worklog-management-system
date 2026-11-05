import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { AuditInput } from "../audit/audit.repository.js";
import { appendAudit as writeAudit } from "../audit/audit.repository.js";
import type { AuthAccountStatus, AuthRole } from "../auth/auth.repository.js";
import { hashPassword } from "../auth/password.js";
import { lockPersonnelActivity } from "../../shared/personnel-lock.js";

export interface AdminUserRecord {
  id: string;
  username: string;
  displayName: string | null;
  passwordHash: string;
  role: AuthRole;
  accountStatus: AuthAccountStatus;
  departmentId: string | null;
  mustChangePassword: boolean;
}

export interface ApproverAssignmentInput {
  approverId: string;
  position: number;
}

export interface ScheduleSettings {
  submissionDeadline: string;
  reminderMinutesBefore: number;
  approvalDeadline: string;
  timezone: "Asia/Shanghai";
  logReminderExcludedWeekdays?: number[];
  logReminderExcludedDates?: string[];
}

export type DeleteUserResult = AdminUserRecord | null;

export interface AdministrationRepository {
  findUserByUsername(username: string): Promise<AdminUserRecord | null>;
  findUserById(userId: string): Promise<AdminUserRecord | null>;
  listUsers(): Promise<AdminUserRecord[]>;
  listDepartments(): Promise<{ id: string; name: string }[]>;
  findDepartmentById(departmentId: string): Promise<{ id: string; name: string } | null>;
  createDepartment(name: string): Promise<{ id: string; name: string }>;
  renameDepartment(departmentId: string, name: string): Promise<{ id: string; name: string }>;
  setNumberPrefix?(departmentId: string, prefix: string | null): Promise<{ id: string; name: string; employeeNumberPrefix: string | null }>;
  listDepartmentEmployees(departmentId: string): Promise<AdminUserRecord[]>;
  updateEmployee(userId: string, expectedDepartmentId: string | null, input: { username?: string; displayName?: string; departmentId: string }): Promise<AdminUserRecord>;
  createUser(input: Omit<AdminUserRecord, "id">): Promise<AdminUserRecord>;
  registerEmployee(input: Omit<AdminUserRecord, "id">): Promise<AdminUserRecord>;
  deleteUser(actorId: string, userId: string): Promise<DeleteUserResult>;
  setUserStatus(userId: string, status: AuthAccountStatus): Promise<AdminUserRecord>;
  resetPassword(userId: string, passwordHash: string, revokedAt: Date): Promise<AdminUserRecord>;
  replaceApprovers(employeeId: string, assignments: ApproverAssignmentInput[]): Promise<void>;
  listApprovers(employeeId: string): Promise<ApproverAssignmentInput[]>;
  listAuthorizedEmployeeIds(actorId: string): Promise<string[]>;
  getSettings(): Promise<ScheduleSettings>;
  saveSettings(settings: ScheduleSettings, patch?: Partial<ScheduleSettings>): Promise<ScheduleSettings>;
  appendAudit(input: AuditInput): Promise<void>;
}

export class AdministrationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function publicAdminUser(user: AdminUserRecord) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export class UserService {
  constructor(private readonly repository: AdministrationRepository) {}

  listUsers() {
    return this.repository.listUsers();
  }

  listDepartments() {
    return this.repository.listDepartments();
  }

  private async requireDepartment(departmentId: string) {
    const department = await this.repository.findDepartmentById(departmentId);
    if (!department) throw new AdministrationError(400, "INVALID_DEPARTMENT", "所选部门不存在，请刷新后重新选择");
    return department;
  }

  private async requireDepartmentAccess(actor: { id: string; role: AuthRole }, departmentId: string) {
    if (!["ADMIN", "MANAGEMENT", "LEADER"].includes(actor.role)) {
      throw new AdministrationError(403, "FORBIDDEN", "无权管理员工");
    }
    if (actor.role === "LEADER") {
      const leader = await this.repository.findUserById(actor.id);
      if (!leader?.departmentId || leader.departmentId !== departmentId) {
        throw new AdministrationError(403, "FORBIDDEN", "领导仅可查看和维护本部门员工");
      }
    }
    return this.requireDepartment(departmentId);
  }

  async listManagedDepartments(actor: { id: string; role: AuthRole }) {
    const departments = await this.repository.listDepartments();
    if (actor.role === "ADMIN" || actor.role === "MANAGEMENT") return departments;
    if (actor.role !== "LEADER") throw new AdministrationError(403, "FORBIDDEN", "无权查看部门员工");
    const leader = await this.repository.findUserById(actor.id);
    return departments.filter((department) => department.id === leader?.departmentId);
  }

  async listDepartmentEmployees(actor: { id: string; role: AuthRole }, departmentId: string) {
    await this.requireDepartmentAccess(actor, departmentId);
    return this.repository.listDepartmentEmployees(departmentId);
  }

  async createDepartmentEmployee(actor: { id: string; role: AuthRole }, departmentId: string, input: { username: string; displayName: string; initialPassword: string }) {
    await this.requireDepartmentAccess(actor, departmentId);
    return this.createUser(actor.id, { ...input, role: "EMPLOYEE", departmentId });
  }

  async updateDepartmentEmployee(actor: { id: string; role: AuthRole }, departmentId: string, userId: string, input: { username: string; displayName: string; departmentId: string }) {
    await this.requireDepartmentAccess(actor, departmentId);
    const user = await this.repository.findUserById(userId);
    if (!user || user.role !== "EMPLOYEE" || user.departmentId !== departmentId) {
      throw new AdministrationError(404, "USER_NOT_FOUND", "该部门下不存在此员工，请刷新后重试");
    }
    await this.requireDepartmentAccess(actor, input.departmentId);
    const duplicate = await this.repository.findUserByUsername(input.username.trim());
    if (duplicate && duplicate.id !== userId) throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
    const updated = await this.repository.updateEmployee(userId, departmentId, {
      username: input.username.trim(), displayName: input.displayName.trim(), departmentId: input.departmentId
    });
    await this.repository.appendAudit({ actorId: actor.id, subjectUserId: userId, action: "EMPLOYEE_UPDATED", entityType: "User", entityId: userId,
      metadata: { previousDepartmentId: departmentId, departmentId: updated.departmentId, username: updated.username, displayName: updated.displayName } });
    return updated;
  }

  async getEmployeeProfile(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !["EMPLOYEE", "LEADER", "MANAGEMENT"].includes(user.role)) throw new AdministrationError(404, "USER_NOT_FOUND", "员工档案不存在");
    return user;
  }

  async setOwnDepartment(userId: string, departmentId: string) {
    const user = await this.getEmployeeProfile(userId);
    await this.requireDepartment(departmentId);
    const updated = await this.repository.updateEmployee(userId, user.departmentId, { departmentId });
    await this.repository.appendAudit({ actorId: userId, subjectUserId: userId, action: "EMPLOYEE_DEPARTMENT_SELECTED", entityType: "User", entityId: userId,
      metadata: { previousDepartmentId: user.departmentId, departmentId } });
    return updated;
  }

  async setNumberPrefix(actorId: string, departmentId: string, prefix: string | null) {
    await this.requireDepartment(departmentId);
    if (!this.repository.setNumberPrefix) throw new AdministrationError(503, "UNAVAILABLE", "当前环境未启用工号标识配置");
    const department = await this.repository.setNumberPrefix(departmentId, prefix || null);
    await this.repository.appendAudit({ actorId, action: "DEPARTMENT_NUMBER_PREFIX_CHANGED", entityType: "Department", entityId: departmentId, metadata: { prefix } });
    return department;
  }

  async registerEmployee(input: { username: string; displayName: string; password: string }) {
    const username = input.username.trim();
    return this.repository.registerEmployee({
      username,
      displayName: input.displayName.trim(),
      passwordHash: await hashPassword(input.password),
      role: "EMPLOYEE",
      accountStatus: "DISABLED",
      departmentId: null,
      mustChangePassword: false
    });
  }

  async createUser(
    actorId: string,
    input: {
      username: string;
      displayName?: string | null | undefined;
      initialPassword: string;
      role: AuthRole;
      departmentId?: string | null | undefined;
    }
  ) {
    const username = input.username.trim();
    if (input.departmentId) await this.requireDepartment(input.departmentId);
    if (await this.repository.findUserByUsername(username)) {
      throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
    }
    const user = await this.repository.createUser({
      username,
      displayName: input.displayName?.trim() || null,
      passwordHash: await hashPassword(input.initialPassword),
      role: input.role,
      accountStatus: "ACTIVE",
      departmentId: input.departmentId ?? null,
      mustChangePassword: true
    });
    await this.repository.appendAudit({
      actorId,
      subjectUserId: user.id,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      metadata: { username: user.username, role: user.role }
    });
    return user;
  }

  async setStatus(actorId: string, userId: string, status: AuthAccountStatus) {
    if (actorId === userId && status === "DISABLED") {
      throw new AdministrationError(400, "CANNOT_DISABLE_SELF", "不能停用当前登录的管理员账号");
    }
    const user = await this.repository.setUserStatus(userId, status);
    await this.repository.appendAudit({
      actorId,
      subjectUserId: userId,
      action: "USER_STATUS_CHANGED",
      entityType: "User",
      entityId: userId,
      metadata: { status }
    });
    return user;
  }

  async deleteUser(actorId: string, userId: string) {
    if (actorId === userId) {
      throw new AdministrationError(400, "CANNOT_DELETE_SELF", "不能删除当前登录的管理员账号");
    }
    const result = await this.repository.deleteUser(actorId, userId);
    if (!result) {
      throw new AdministrationError(404, "USER_NOT_FOUND", "用户不存在");
    }
    return result;
  }

  async resetPassword(actorId: string, userId: string, initialPassword: string) {
    const user = await this.repository.resetPassword(
      userId,
      await hashPassword(initialPassword),
      new Date()
    );
    await this.repository.appendAudit({
      actorId,
      subjectUserId: userId,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: userId,
      metadata: {}
    });
    return user;
  }

  async createDepartment(actorId: string, name: string) {
    if ((await this.repository.listDepartments()).some((department) => department.name === name.trim())) {
      throw new AdministrationError(409, "DEPARTMENT_EXISTS", "部门名称已存在，请使用其他名称");
    }
    const department = await this.repository.createDepartment(name.trim());
    await this.repository.appendAudit({
      actorId,
      action: "DEPARTMENT_CREATED",
      entityType: "Department",
      entityId: department.id,
      metadata: { name: department.name }
    });
    return department;
  }

  async renameDepartment(actorId: string, departmentId: string, name: string) {
    const current = await this.repository.findDepartmentById(departmentId);
    if (!current) throw new AdministrationError(404, "DEPARTMENT_NOT_FOUND", "部门不存在，请刷新后重试");
    if ((await this.repository.listDepartments()).some((department) => department.id !== departmentId && department.name === name.trim())) {
      throw new AdministrationError(409, "DEPARTMENT_EXISTS", "部门名称已存在，请使用其他名称");
    }
    const department = await this.repository.renameDepartment(departmentId, name.trim());
    await this.repository.appendAudit({ actorId, action: "DEPARTMENT_RENAMED", entityType: "Department", entityId: departmentId,
      metadata: { previousName: current.name, name: department.name } });
    return department;
  }
}

const employeeSelect = {
  id: true, username: true, displayName: true, passwordHash: true, role: true,
  accountStatus: true, departmentId: true, mustChangePassword: true
} as const;

export class PrismaAdministrationRepository implements AdministrationRepository {
  constructor(private readonly database: PrismaClient) {}

  findUserById(userId: string) {
    return this.database.user.findFirst({ where: { id: userId, deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, select: employeeSelect });
  }

  findDepartmentById(departmentId: string) {
    return this.database.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true } });
  }

  listDepartmentEmployees(departmentId: string) {
    return this.database.user.findMany({ where: { departmentId, role: "EMPLOYEE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, orderBy: { username: "asc" }, select: employeeSelect });
  }

  async renameDepartment(departmentId: string, name: string) {
    try {
      return await this.database.department.update({ where: { id: departmentId }, data: { name }, select: { id: true, name: true } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if (error.code === "P2002") throw new AdministrationError(409, "DEPARTMENT_EXISTS", "部门名称已存在，请使用其他名称");
        if (error.code === "P2025") throw new AdministrationError(404, "DEPARTMENT_NOT_FOUND", "部门不存在，请刷新后重试");
      }
      throw error;
    }
  }

  async updateEmployee(userId: string, expectedDepartmentId: string | null, input: { username?: string; displayName?: string; departmentId: string }) {
    try {
      return await this.database.$transaction(async (transaction) => {
        const changed = await transaction.user.updateMany({
          where: { id: userId, departmentId: expectedDepartmentId, role: "EMPLOYEE", employmentStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, data: input
        });
        if (changed.count !== 1) throw new AdministrationError(409, "EMPLOYEE_CHANGED", "员工所属部门已发生变化，请刷新后重试");
        const user = await transaction.user.findFirst({ where: { id: userId, deletedAt: null }, select: employeeSelect });
        if (!user) throw new AdministrationError(404, "USER_NOT_FOUND", "员工不存在，请刷新后重试");
        return user;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if (error.code === "P2002") throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
        if (error.code === "P2003") throw new AdministrationError(400, "INVALID_DEPARTMENT", "所选部门不存在，请重新选择");
      }
      throw error;
    }
  }

  private async returnPendingApprovals(transaction: Prisma.TransactionClient, userId: string) {
    await lockPersonnelActivity(transaction);
    const pendingSteps = await transaction.approvalStep.findMany({
      where: { approverId: userId, status: "PENDING" },
      select: { dailyLogId: true, dailyLog: { select: { employee: { select: { employmentStatus: true } } } } },
      distinct: ["dailyLogId"]
    });
    if (pendingSteps.some((step) => step.dailyLog?.employee.employmentStatus === "DEPARTED")) {
      throw new AdministrationError(409, "DEPARTED_APPROVAL_HANDOVER_REQUIRED", "存在离职员工的待审日志，请先完成审批或由人事移交管理层，再停用或删除账号");
    }
    for (const { dailyLogId } of pendingSteps) {
      await transaction.approvalStep.updateMany({
        where: { dailyLogId, status: "PENDING" },
        data: { status: "SUPERSEDED" }
      });
      await transaction.dailyLog.updateMany({
        where: { id: dailyLogId, status: { in: ["SUBMITTED", "IN_REVIEW"] } },
        data: { status: "RETURNED", color: "GREEN", version: { increment: 1 } }
      });
    }
  }

  async findUserByUsername(username: string) {
    return this.database.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
        accountStatus: true,
        departmentId: true,
        mustChangePassword: true
      }
    });
  }

  async listUsers() {
    return this.database.user.findMany({
      where: { deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
      orderBy: [{ accountStatus: "asc" }, { username: "asc" }],
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
        accountStatus: true,
        departmentId: true,
        mustChangePassword: true
      }
    });
  }

  listDepartments() {
    return this.database.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, employeeNumberPrefix: true } });
  }

  setNumberPrefix(departmentId: string, prefix: string | null) {
    return this.database.department.update({ where: { id: departmentId }, data: { employeeNumberPrefix: prefix }, select: { id: true, name: true, employeeNumberPrefix: true } });
  }

  async createDepartment(name: string) {
    try {
      return await this.database.department.create({ data: { name }, select: { id: true, name: true } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new AdministrationError(409, "DEPARTMENT_EXISTS", "部门名称已存在，请使用其他名称");
      }
      throw error;
    }
  }

  async createUser(input: Omit<AdminUserRecord, "id">) {
    try {
      return await this.database.user.create({
      data: input,
      select: {
        id: true,
        username: true,
        displayName: true,
        passwordHash: true,
        role: true,
        accountStatus: true,
        departmentId: true,
        mustChangePassword: true
      }
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if (error.code === "P2002") throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
        if (error.code === "P2003") throw new AdministrationError(400, "INVALID_DEPARTMENT", "所选部门不存在，请重新选择");
      }
      throw error;
    }
  }

  async registerEmployee(input: Omit<AdminUserRecord, "id">) {
    try {
      return await this.database.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: input,
          select: {
            id: true,
            username: true,
            displayName: true,
            passwordHash: true,
            role: true,
            accountStatus: true,
            departmentId: true,
            mustChangePassword: true
          }
        });
        await writeAudit(transaction, {
          actorId: null,
          subjectUserId: user.id,
          action: "EMPLOYEE_SELF_REGISTERED",
          entityType: "User",
          entityId: user.id,
          metadata: { username: user.username }
        });
        return user;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
      }
      throw error;
    }
  }

  async deleteUser(actorId: string, userId: string): Promise<DeleteUserResult> {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.findFirst({
        where: { id: userId, deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        select: {
          id: true,
          username: true,
          displayName: true,
          passwordHash: true,
          role: true,
          accountStatus: true,
          departmentId: true,
          mustChangePassword: true
        }
      });
      if (!user) return null;
      const deletedAt = new Date();
      await this.returnPendingApprovals(transaction, userId);

      await transaction.employeeApprover.deleteMany({
        where: { OR: [{ employeeId: userId }, { approverId: userId }] }
      });
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt }
      });
      await transaction.user.update({
        where: { id: userId, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        data: {
          username: `deleted-${userId}`,
          accountStatus: "DISABLED",
          deletedAt
        }
      });
      await writeAudit(transaction, {
        actorId,
        subjectUserId: userId,
        action: "USER_DELETED",
        entityType: "User",
        entityId: userId,
        metadata: { username: user.username, role: user.role }
      });
      return user;
    });
  }

  async setUserStatus(userId: string, accountStatus: AuthAccountStatus) {
    return this.database.$transaction(async (transaction) => {
      if (accountStatus === "DISABLED") {
        await this.returnPendingApprovals(transaction, userId);
        await transaction.employeeApprover.deleteMany({ where: { approverId: userId } });
      }
      return transaction.user.update({
        where: { id: userId, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        data: { accountStatus },
        select: {
          id: true, username: true, displayName: true, passwordHash: true, role: true,
          accountStatus: true, departmentId: true, mustChangePassword: true
        }
      });
    });
  }

  async resetPassword(userId: string, passwordHash: string, revokedAt: Date) {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: userId, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
        select: {
          id: true,
          username: true,
          displayName: true,
          passwordHash: true,
          role: true,
          accountStatus: true,
          departmentId: true,
          mustChangePassword: true
        }
      });
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt }
      });
      return user;
    });
  }

  async replaceApprovers(employeeId: string, assignments: ApproverAssignmentInput[]) {
    await this.database.$transaction(async (transaction) => {
      await lockPersonnelActivity(transaction);
      const employee = await transaction.user.findFirst({
        where: { id: employeeId, role: "EMPLOYEE", accountStatus: "ACTIVE", employmentStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        select: { id: true }
      });
      const approvers = await transaction.user.count({
        where: {
          id: { in: assignments.map(({ approverId }) => approverId) },
          role: { in: ["LEADER", "MANAGEMENT", "ADMIN"] },
          accountStatus: "ACTIVE", employmentStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null
        }
      });
      if (!employee || approvers !== assignments.length) {
        throw new AdministrationError(400, "INVALID_APPROVER", "审批人必须是启用中的领导账号");
      }
      await transaction.employeeApprover.deleteMany({ where: { employeeId } });
      if (assignments.length > 0) {
        await transaction.employeeApprover.createMany({
          data: assignments.map((assignment) => ({ employeeId, ...assignment }))
        });
      }
    });
  }

  async listAuthorizedEmployeeIds(actorId: string) {
    const rows = await this.database.employeeApprover.findMany({
      where: { approverId: actorId, active: true },
      select: { employeeId: true },
      distinct: ["employeeId"]
    });
    return rows.map((row) => row.employeeId);
  }

  async listApprovers(employeeId: string) {
    return this.database.employeeApprover.findMany({
      where: { employeeId, active: true },
      orderBy: { position: "asc" },
      select: { approverId: true, position: true }
    });
  }

  async getSettings(): Promise<ScheduleSettings> {
    const setting = await this.database.systemSetting.findUnique({ where: { key: "worklog.schedule" } });
    return (setting?.value as unknown as ScheduleSettings | undefined) ?? {
      submissionDeadline: "18:00",
      reminderMinutesBefore: 30,
      approvalDeadline: "12:00",
      timezone: "Asia/Shanghai"
    };
  }

  async saveSettings(settings: ScheduleSettings, patch: Partial<ScheduleSettings> = settings) {
    await this.database.$executeRaw`INSERT INTO system_settings (key, value, updated_at)
      VALUES ('worklog.schedule', ${JSON.stringify(settings)}::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = system_settings.value || ${JSON.stringify(patch)}::jsonb, updated_at = CURRENT_TIMESTAMP`;
    return this.getSettings();
  }

  async appendAudit(input: AuditInput) {
    await this.database.$transaction(async (transaction) => writeAudit(transaction, input));
  }
}
