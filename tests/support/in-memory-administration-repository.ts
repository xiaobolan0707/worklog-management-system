import { AdministrationError } from "../../src/modules/users/user.service.js";
import type {
  AdministrationRepository,
  AdminUserRecord,
  ApproverAssignmentInput,
  ScheduleSettings
} from "../../src/modules/users/user.service.js";
import type { InMemoryAuthRepository } from "./in-memory-auth-repository.js";

export class InMemoryAdministrationRepository implements AdministrationRepository {
  readonly users = new Map<string, AdminUserRecord>();
  readonly departments = new Map<string, { id: string; name: string }>();
  readonly approvers = new Map<string, ApproverAssignmentInput[]>();
  readonly protectedUsers = new Set<string>();
  readonly deletedUsers = new Set<string>();
  settings: ScheduleSettings = {
    submissionDeadline: "18:00",
    reminderMinutesBefore: 30,
    approvalDeadline: "12:00",
    timezone: "Asia/Shanghai"
  };

  constructor(private readonly authRepository?: InMemoryAuthRepository) {}

  async findUserById(userId: string) {
    if (this.deletedUsers.has(userId)) return null;
    const user = this.users.get(userId);
    if (user) return user;
    const authUser = await this.authRepository?.findUserById(userId);
    return authUser ? { ...authUser, departmentId: null } : null;
  }

  async findDepartmentById(departmentId: string) {
    return this.departments.get(departmentId) ?? null;
  }

  async renameDepartment(departmentId: string, name: string) {
    const department = this.departments.get(departmentId);
    if (!department) throw new AdministrationError(404, "DEPARTMENT_NOT_FOUND", "部门不存在");
    if ([...this.departments.values()].some((item) => item.id !== departmentId && item.name === name)) {
      throw new AdministrationError(409, "DEPARTMENT_EXISTS", "部门名称已存在");
    }
    department.name = name;
    return department;
  }

  async listDepartmentEmployees(departmentId: string) {
    return (await this.listUsers()).filter((user) => user.departmentId === departmentId && user.role === "EMPLOYEE");
  }

  async updateEmployee(userId: string, expectedDepartmentId: string | null, input: { username?: string; displayName?: string; departmentId: string }) {
    const user = this.users.get(userId);
    if (!user || this.deletedUsers.has(userId) || user.role !== "EMPLOYEE" || user.departmentId !== expectedDepartmentId) {
      throw new AdministrationError(409, "EMPLOYEE_CHANGED", "员工所属部门已发生变化，请刷新后重试");
    }
    if (!this.departments.has(input.departmentId)) throw new AdministrationError(400, "INVALID_DEPARTMENT", "所选部门不存在");
    if (input.username && [...this.users.values()].some((item) => item.id !== userId && item.username === input.username)) {
      throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
    }
    Object.assign(user, input);
    const authUser = this.authRepository?.users.get(userId);
    if (authUser) Object.assign(authUser, input);
    return user;
  }

  async findUserByUsername(username: string) {
    const user = [...this.users.values()].find((item) => item.username === username && !this.deletedUsers.has(item.id));
    if (user) return user;
    const authUser = await this.authRepository?.findUserByUsername(username);
    return authUser ? { ...authUser, departmentId: null } : null;
  }

  async listUsers() {
    return [...this.users.values()].filter((user) => !this.deletedUsers.has(user.id)).sort((left, right) => left.username.localeCompare(right.username));
  }

  async listDepartments() {
    return [...this.departments.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async createDepartment(name: string) {
    const department = { id: `department-${this.departments.size + 1}`, name };
    this.departments.set(department.id, department);
    return department;
  }

  async createUser(input: Omit<AdminUserRecord, "id">) {
    const user = { id: `user-${this.users.size + 1}`, ...input };
    this.users.set(user.id, user);
    this.authRepository?.addUser({
      ...user,
      failedLoginCount: 0,
      lockedUntil: null
    });
    return user;
  }

  async registerEmployee(input: Omit<AdminUserRecord, "id">) {
    const duplicate = [...this.users.values()].some((user) => user.username === input.username)
      || [...(this.authRepository?.users.values() ?? [])].some((user) => user.username === input.username);
    if (duplicate) throw new AdministrationError(409, "USERNAME_EXISTS", "用户名已存在");
    return this.createUser(input);
  }

  async deleteUser(_actorId: string, userId: string) {
    const user = this.users.get(userId);
    if (!user) return null;
    user.username = `deleted-${userId}`;
    user.accountStatus = "DISABLED";
    this.deletedUsers.add(userId);
    const authUser = this.authRepository?.users.get(userId);
    if (authUser) {
      authUser.username = user.username;
      authUser.accountStatus = "DISABLED";
    }
    this.approvers.delete(userId);
    for (const [employeeId, assignments] of this.approvers) {
      this.approvers.set(employeeId, assignments.filter((item) => item.approverId !== userId));
    }
    for (const [tokenHash, session] of this.authRepository?.sessions ?? []) {
      if (session.userId === userId) this.authRepository?.sessions.delete(tokenHash);
    }
    return user;
  }

  async setUserStatus(userId: string, accountStatus: "ACTIVE" | "DISABLED") {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    user.accountStatus = accountStatus;
    const authUser = this.authRepository?.users.get(userId);
    if (authUser) authUser.accountStatus = accountStatus;
    return user;
  }

  async resetPassword(userId: string, passwordHash: string, revokedAt: Date) {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    user.passwordHash = passwordHash;
    user.mustChangePassword = true;
    const authUser = this.authRepository?.users.get(userId);
    if (authUser) {
      authUser.passwordHash = passwordHash;
      authUser.mustChangePassword = true;
    }
    for (const session of this.authRepository?.sessions.values() ?? []) {
      if (session.userId === userId) session.revokedAt = revokedAt;
    }
    return user;
  }

  async replaceApprovers(employeeId: string, assignments: ApproverAssignmentInput[]) {
    const employee = this.users.get(employeeId);
    if (!employee || employee.role !== "EMPLOYEE" || employee.accountStatus !== "ACTIVE") {
      throw new AdministrationError(400, "INVALID_APPROVER", "审批人必须是启用中的领导账号");
    }
    for (const { approverId } of assignments) {
      const approver = this.users.get(approverId) ?? this.authRepository?.users.get(approverId);
      if (!approver || !["LEADER", "MANAGEMENT", "ADMIN"].includes(approver.role) || approver.accountStatus !== "ACTIVE") {
        throw new AdministrationError(400, "INVALID_APPROVER", "审批人必须是启用中的领导账号");
      }
    }
    this.approvers.set(employeeId, assignments);
  }

  async listAuthorizedEmployeeIds(actorId: string) {
    return [...this.approvers.entries()]
      .filter(([, assignments]) => assignments.some((item) => item.approverId === actorId))
      .map(([employeeId]) => employeeId);
  }

  async listApprovers(employeeId: string) {
    return [...(this.approvers.get(employeeId) ?? [])].sort((a, b) => a.position - b.position);
  }

  async getSettings() {
    return this.settings;
  }

  async saveSettings(settings: ScheduleSettings) {
    this.settings = settings;
    return settings;
  }

  async appendAudit() {}
}
