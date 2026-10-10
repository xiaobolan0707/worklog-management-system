import type { PrismaClient } from "../../generated/prisma/client.js";
import { appendAudit as writeAudit, type AuditInput } from "../audit/audit.repository.js";

export type AuthRole = "EMPLOYEE" | "LEADER" | "MANAGEMENT" | "ADMIN";
export type AuthAccountStatus = "ACTIVE" | "DISABLED";
export type LoginOutcomeValue = "SUCCESS" | "FAILURE" | "LOCKED";

export interface AuthUserRecord {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  role: AuthRole;
  accountStatus: AuthAccountStatus;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfSecret: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  csrfSecret: string;
  expiresAt: Date;
}

export interface LoginAttemptInput {
  username: string;
  userId: string | null;
  ipAddress: string | null;
  outcome: LoginOutcomeValue;
}

export interface AuthRepository {
  findUserByUsername(username: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  recordFailedLogin(userId: string, lockedUntil: Date | null): Promise<void>;
  resetLoginFailures(userId: string): Promise<void>;
  recordLoginAttempt(input: LoginAttemptInput): Promise<void>;
  createSession(input: CreateSessionInput): Promise<AuthSessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  updateInitialPassword(userId: string, passwordHash: string): Promise<void>;
  appendAudit(input: AuditInput): Promise<void>;
}

const authUserSelect = {
  id: true,
  username: true,
  passwordHash: true,
  displayName: true,
  role: true,
  accountStatus: true,
  mustChangePassword: true,
  failedLoginCount: true,
  lockedUntil: true
} as const;

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly database: PrismaClient) {}

  async findUserByUsername(username: string) {
    return this.database.user.findUnique({ where: { username }, select: authUserSelect });
  }

  async findUserById(id: string) {
    return this.database.user.findUnique({ where: { id }, select: authUserSelect });
  }

  async recordFailedLogin(userId: string, lockedUntil: Date | null) {
    await this.database.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 }, lockedUntil }
    });
  }

  async resetLoginFailures(userId: string) {
    await this.database.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null }
    });
  }

  async recordLoginAttempt(input: LoginAttemptInput) {
    await this.database.loginAttempt.create({ data: input });
  }

  async createSession(input: CreateSessionInput) {
    return this.database.session.create({ data: input });
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.database.session.findUnique({ where: { tokenHash } });
  }

  async revokeSession(sessionId: string, revokedAt: Date) {
    await this.database.session.update({ where: { id: sessionId }, data: { revokedAt } });
  }

  async updateInitialPassword(userId: string, passwordHash: string) {
    await this.database.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null }
    });
  }

  async appendAudit(input: AuditInput) {
    await this.database.$transaction(async (transaction) => {
      await writeAudit(transaction, input);
    });
  }
}
