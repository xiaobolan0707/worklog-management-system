import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { AuditInput } from "../audit/audit.repository.js";
import { appendAudit as writeAudit } from "../audit/audit.repository.js";
import type { AuthAccountStatus, AuthRole } from "../auth/auth.repository.js";
import { hashPassword } from "../auth/password.js";

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
}

export type DeleteUserResult = AdminUserRecord | null;

export interface AdministrationRepository {
  findUserByUsername(username: string): Promise<AdminUserRecord | null>;
  listUsers(): Promise<AdminUserRecord[]>;
  listDepartments(): Promise<{ id: string; name: string }[]>;
  createDepartment(name: string): Promise<{ id: string; name: string }>;
  createUser(input: Omit<AdminUserRecord, "id">): Promise<AdminUserRecord>;
  deleteUser(actorId: string, userId: string): Promise<DeleteUserResult>;
  setUserStatus(userId: string, status: AuthAccountStatus): Promise<AdminUserRecord>;
  resetPassword(userId: string, passwordHash: string, revokedAt: Date): Promise<AdminUserRecord>;
  replaceApprovers(employeeId: string, assignments: ApproverAssignmentInput[]): Promise<void>;
  listAuthorizedEmployeeIds(actorId: string): Promise<string[]>;
  getSettings(): Promise<ScheduleSettings>;
  saveSettings(settings: ScheduleSettings): Promise<ScheduleSettings>;
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
}

export class PrismaAdministrationRepository implements AdministrationRepository {
  constructor(private readonly database: PrismaClient) {}

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
      where: { deletedAt: null },
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
    return this.database.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  }

  async createDepartment(name: string) {
    return this.database.department.create({ data: { name }, select: { id: true, name: true } });
  }

  async createUser(input: Omit<AdminUserRecord, "id">) {
    return this.database.user.create({
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
  }

  async deleteUser(actorId: string, userId: string): Promise<DeleteUserResult> {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.findFirst({
        where: { id: userId, deletedAt: null },
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
      const pendingSteps = await transaction.approvalStep.findMany({
        where: { approverId: userId, status: "PENDING" },
        select: { dailyLogId: true },
        distinct: ["dailyLogId"]
      });

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

      await transaction.employeeApprover.deleteMany({
        where: { OR: [{ employeeId: userId }, { approverId: userId }] }
      });
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: deletedAt }
      });
      await transaction.user.update({
        where: { id: userId },
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
    return this.database.user.update({
      where: { id: userId },
      data: { accountStatus },
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

  async resetPassword(userId: string, passwordHash: string, revokedAt: Date) {
    return this.database.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: userId },
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

  async getSettings(): Promise<ScheduleSettings> {
    const setting = await this.database.systemSetting.findUnique({ where: { key: "worklog.schedule" } });
    return (setting?.value as unknown as ScheduleSettings | undefined) ?? {
      submissionDeadline: "18:00",
      reminderMinutesBefore: 30,
      approvalDeadline: "12:00",
      timezone: "Asia/Shanghai"
    };
  }

  async saveSettings(settings: ScheduleSettings) {
    const value = settings as unknown as Prisma.InputJsonValue;
    await this.database.systemSetting.upsert({
      where: { key: "worklog.schedule" },
      create: { key: "worklog.schedule", value },
      update: { value }
    });
    return settings;
  }

  async appendAudit(input: AuditInput) {
    await this.database.$transaction(async (transaction) => writeAudit(transaction, input));
  }
}
