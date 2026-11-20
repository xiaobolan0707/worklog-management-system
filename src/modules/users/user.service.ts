import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import type { AuditInput } from "../audit/audit.repository.js";
import { appendAudit as writeAudit } from "../audit/audit.repository.js";
import type { AuthAccountStatus, AuthRole } from "../auth/auth.repository.js";
import { hashPassword } from "../auth/password.js";
import { passwordStrengthError } from "../auth/password-policy.js";
import { lockPersonnelActivity } from "../../shared/personnel-lock.js";

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

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
  /** 移出前的资格查询：需要同时看到在职状态与账号状态。 */
  findDetachCandidate(userId: string): Promise<{ departmentId: string | null; role: AuthRole; employmentStatus: string; accountStatus: AuthAccountStatus } | null>;
  /** 移出部门：只清空部门归属，工号字段原样保留。 */
  detachEmployee(userId: string, expectedDepartmentId: string): Promise<{ user: AdminUserRecord; employeeNumberLabel: string | null }>;
  createUser(input: Omit<AdminUserRecord, "id">): Promise<AdminUserRecord>;
  registerEmployee(input: Omit<AdminUserRecord, "id">): Promise<AdminUserRecord>;
  deleteUser(actorId: string, userId: string): Promise<DeleteUserResult>;
  setUserStatus(userId: string, status: AuthAccountStatus): Promise<AdminUserRecord>;
  resetPassword(userId: string, passwordHash: string, revokedAt: Date): Promise<AdminUserRecord>;
  replaceApprovers(employeeId: string, assignments: ApproverAssignmentInput[]): Promise<void>;
  listApprovers(employeeId: string): Promise<ApproverAssignmentInput[]>;
  listAuthorizedEmployeeIds(actorId: string): Promise<string[]>;
  /** SEC-07：统计仍可登录的管理员数量，用于"最后一名管理员"保护。 */
  countActiveAdmins(): Promise<number>;
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

  private assertPasswordStrength(input: { password: string; username: string; displayName?: string | null | undefined }) {
    const weakness = passwordStrengthError(input);
    if (weakness) throw new AdministrationError(400, "PASSWORD_TOO_WEAK", weakness);
  }

  /** SEC-07：停用/删除/离职前调用，确保系统始终保有可运维的管理员。 */
  private async assertNotLastAdmin(userId: string) {
    const target = await this.repository.findUserById(userId);
    if (!target || target.role !== "ADMIN" || target.accountStatus !== "ACTIVE") return;
    const activeAdmins = await this.repository.countActiveAdmins();
    if (activeAdmins <= 1) {
      throw new AdministrationError(400, "LAST_ADMIN_REQUIRED", "系统至少需要保留一名可用管理员，请先新增或启用其他管理员账号");
    }
  }

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
    if (!["ADMIN", "MANAGEMENT", "LEADER", "HR"].includes(actor.role)) {
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
    if (actor.role === "ADMIN" || actor.role === "MANAGEMENT" || actor.role === "HR") return departments;
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

  async removeDepartmentEmployee(actor: { id: string; role: AuthRole }, departmentId: string, userId: string) {
    await this.requireDepartmentAccess(actor, departmentId);
    const candidate = await this.repository.findDetachCandidate(userId);
    if (!candidate || candidate.role !== "EMPLOYEE" || candidate.departmentId !== departmentId) {
      throw new AdministrationError(404, "USER_NOT_FOUND", "该部门下不存在此员工，请刷新后重试");
    }
    // 仅「账号停用」或「已离职」的员工可以移出部门，避免误移在职人员。
    if (candidate.employmentStatus !== "DEPARTED" && candidate.accountStatus !== "DISABLED") {
      throw new AdministrationError(409, "EMPLOYEE_STILL_ACTIVE", "该员工账号仍在启用，请先停用账号或办理离职后再移出部门");
    }
    const { user, employeeNumberLabel } = await this.repository.detachEmployee(userId, departmentId);
    // 工号不随移出部门释放：保留三个月，期间不复用、不清空。
    const numberRetainedUntil = addMonths(new Date(), 3);
    await this.repository.appendAudit({
      actorId: actor.id, subjectUserId: userId, action: "EMPLOYEE_REMOVED_FROM_DEPARTMENT",
      entityType: "User", entityId: userId,
      metadata: { previousDepartmentId: departmentId, employeeNumberLabel, numberRetainedUntil: numberRetainedUntil.toISOString() }
    });
    return { user, employeeNumberLabel, numberRetainedUntil: numberRetainedUntil.toISOString() };
  }

  async listAssignableEmployees(actor: { id: string; role: AuthRole }) {
    if (!["ADMIN", "MANAGEMENT", "LEADER", "HR"].includes(actor.role)) {
      throw new AdministrationError(403, "FORBIDDEN", "无权查看员工");
    }
    // 取全部用户后过滤，这样「未分配部门」的员工也能出现在调入列表里。
    const users = await this.repository.listUsers();
    let rows = users.filter((user) => user.role === "EMPLOYEE");
    if (actor.role === "LEADER") {
      const leader = await this.repository.findUserById(actor.id);
      rows = rows.filter((user) => user.departmentId === leader?.departmentId);
    }
    return rows.map((user) => ({
      id: user.id, username: user.username, displayName: user.displayName, departmentId: user.departmentId ?? null
    }));
  }

  async assignEmployee(actor: { id: string; role: AuthRole }, departmentId: string, employeeId: string) {
    await this.requireDepartmentAccess(actor, departmentId);
    const employee = await this.repository.findUserById(employeeId);
    if (!employee || employee.role !== "EMPLOYEE") {
      throw new AdministrationError(404, "USER_NOT_FOUND", "员工不存在，请刷新后重试");
    }
    if (employee.departmentId === departmentId) {
      return { id: employee.id, username: employee.username, displayName: employee.displayName, departmentId: employee.departmentId };
    }
    const updated = await this.repository.updateEmployee(employeeId, employee.departmentId, { departmentId });
    await this.repository.appendAudit({
      actorId: actor.id, subjectUserId: employeeId, action: "EMPLOYEE_DEPARTMENT_ASSIGNED",
      entityType: "User", entityId: employeeId,
      metadata: { previousDepartmentId: employee.departmentId, departmentId }
    });
    return { id: updated.id, username: updated.username, displayName: updated.displayName, departmentId: updated.departmentId };
  }

  async getEmployeeProfile(userId: string) {
    const user = await this.repository.findUserById(userId);
    if (!user || !["EMPLOYEE", "LEADER", "MANAGEMENT"].includes(user.role)) throw new AdministrationError(404, "USER_NOT_FOUND", "员工档案不存在");
    return user;
  }

  async setOwnDepartment(userId: string, departmentId: string) {
    const user = await this.getEmployeeProfile(userId);
    // SEC-08：部门是数据可见域边界，仅允许"尚未分配部门"的账号完成首次选择；
    // 已有部门归属的账号必须由 ADMIN/HR 在管理端调整，避免员工自行切换可见域。
    if (user.departmentId) {
      throw new AdministrationError(403, "DEPARTMENT_CHANGE_FORBIDDEN", "所属部门已由管理员分配，如需调整请联系管理员或人事");
    }
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

  /**
   * 自助注册（SEC-03/SEC-04）。
   * 返回 null 表示该用户名已被占用：此时不创建账号、不向调用方泄露冲突细节，
   * 仅留下审计记录供管理员核查，注册接口对所有情况返回一致响应。
   */
  async registerEmployee(input: { username: string; displayName: string; password: string }): Promise<AdminUserRecord | null> {
    const username = input.username.trim();
    const displayName = input.displayName.trim();
    this.assertPasswordStrength({ password: input.password, username, displayName });
    // 先完成哈希计算再判重，避免"用户名是否存在"通过耗时差异被推断。
    const passwordHash = await hashPassword(input.password);
    if (await this.repository.findUserByUsername(username)) {
      await this.repository.appendAudit({
        actorId: null,
        action: "EMPLOYEE_REGISTRATION_CONFLICT",
        entityType: "User",
        entityId: username,
        metadata: { username, displayName }
      });
      return null;
    }
    try {
      return await this.repository.registerEmployee({
        username,
        displayName,
        passwordHash,
        role: "EMPLOYEE",
        accountStatus: "DISABLED",
        departmentId: null,
        mustChangePassword: false
      });
    } catch (error) {
      // 并发下由唯一约束兜底，同样不对外暴露冲突。
      if (error instanceof AdministrationError && error.code === "USERNAME_EXISTS") return null;
      throw error;
    }
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
    this.assertPasswordStrength({ password: input.initialPassword, username, displayName: input.displayName });
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
    if (status === "DISABLED") await this.assertNotLastAdmin(userId);
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
    await this.assertNotLastAdmin(userId);
    const result = await this.repository.deleteUser(actorId, userId);
    if (!result) {
      throw new AdministrationError(404, "USER_NOT_FOUND", "用户不存在");
    }
    return result;
  }

  async resetPassword(actorId: string, userId: string, initialPassword: string) {
    const target = await this.repository.findUserById(userId);
    if (!target) throw new AdministrationError(404, "USER_NOT_FOUND", "用户不存在");
    this.assertPasswordStrength({ password: initialPassword, username: target.username, displayName: target.displayName });
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
    return this.database.user.findMany({ where: { departmentId, role: "EMPLOYEE", employmentStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null }, orderBy: { username: "asc" }, select: employeeSelect });
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

  findDetachCandidate(userId: string) {
    return this.database.user.findFirst({
      where: { id: userId, deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
      select: { departmentId: true, role: true, employmentStatus: true, accountStatus: true }
    });
  }

  async detachEmployee(userId: string, expectedDepartmentId: string) {
    return this.database.$transaction(async (transaction) => {
      const changed = await transaction.user.updateMany({
        where: { id: userId, departmentId: expectedDepartmentId, role: "EMPLOYEE", employmentStatus: "ACTIVE", deletedAt: null, recycledAt: null, archivePurgingAt: null, archivePurgedAt: null },
        data: { departmentId: null }
      });
      if (changed.count !== 1) throw new AdministrationError(409, "EMPLOYEE_CHANGED", "员工所属部门已发生变化，请刷新后重试");
      const user = await transaction.user.findFirst({ where: { id: userId, deletedAt: null }, select: employeeSelect });
      if (!user) throw new AdministrationError(404, "USER_NOT_FOUND", "员工不存在，请刷新后重试");
      const numbering = await transaction.user.findUnique({ where: { id: userId }, select: { employeeNumber: true, numberDepartmentId: true } });
      let employeeNumberLabel: string | null = null;
      if (numbering?.employeeNumber != null) {
        const numberDepartment = numbering.numberDepartmentId
          ? await transaction.department.findUnique({ where: { id: numbering.numberDepartmentId }, select: { name: true, employeeNumberPrefix: true } })
          : null;
        const prefix = numberDepartment?.employeeNumberPrefix || (numberDepartment?.name ? `${numberDepartment.name} ` : "");
        employeeNumberLabel = `${prefix}${String(numbering.employeeNumber).padStart(4, "0")}`;
      }
      return { user, employeeNumberLabel };
    });
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

  async countActiveAdmins() {
    return this.database.user.count({
      where: {
        role: "ADMIN",
        accountStatus: "ACTIVE",
        employmentStatus: "ACTIVE",
        deletedAt: null,
        recycledAt: null,
        archivePurgingAt: null,
        archivePurgedAt: null,
        OR: [{ loginDisabledAt: null }, { loginDisabledAt: { gt: new Date() } }]
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
