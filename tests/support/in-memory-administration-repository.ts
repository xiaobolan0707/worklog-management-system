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
  settings: ScheduleSettings = {
    submissionDeadline: "18:00",
    reminderMinutesBefore: 30,
    approvalDeadline: "12:00",
    timezone: "Asia/Shanghai"
  };

  constructor(private readonly authRepository?: InMemoryAuthRepository) {}

  async findUserByUsername(username: string) {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async listUsers() {
    return [...this.users.values()].sort((left, right) => left.username.localeCompare(right.username));
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
    return user;
  }

  async deleteUser(_actorId: string, userId: string) {
    const user = this.users.get(userId);
    if (!user) return null;
    if (this.protectedUsers.has(userId)) return "HAS_HISTORY" as const;
    this.users.delete(userId);
    this.authRepository?.users.delete(userId);
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
    this.approvers.set(employeeId, assignments);
  }

  async listAuthorizedEmployeeIds(actorId: string) {
    return [...this.approvers.entries()]
      .filter(([, assignments]) => assignments.some((item) => item.approverId === actorId))
      .map(([employeeId]) => employeeId);
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
