import type {
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  CreateSessionInput,
  LoginAttemptInput
} from "../../src/modules/auth/auth.repository.js";
import type { AuditInput } from "../../src/modules/audit/audit.repository.js";

export class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, AuthSessionRecord>();
  readonly loginAttempts: LoginAttemptInput[] = [];
  readonly audits: AuditInput[] = [];

  addUser(user: AuthUserRecord) {
    this.users.set(user.id, { ...user });
  }

  async findUserByUsername(username: string) {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async findUserById(id: string) {
    return this.users.get(id) ?? null;
  }

  async recordFailedLogin(userId: string, lockedUntil: Date | null) {
    const user = this.users.get(userId);
    if (!user) return;
    user.failedLoginCount += 1;
    user.lockedUntil = lockedUntil;
  }

  async resetLoginFailures(userId: string) {
    const user = this.users.get(userId);
    if (!user) return;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
  }

  async recordLoginAttempt(input: LoginAttemptInput) {
    this.loginAttempts.push(input);
  }

  async createSession(input: CreateSessionInput) {
    const session = { id: `session-${this.sessions.size + 1}`, ...input, revokedAt: null };
    this.sessions.set(session.tokenHash, session);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async revokeSession(sessionId: string, revokedAt: Date) {
    const session = [...this.sessions.values()].find((item) => item.id === sessionId);
    if (session) session.revokedAt = revokedAt;
  }

  async updateInitialPassword(userId: string, passwordHash: string) {
    const user = this.users.get(userId);
    if (!user) throw new Error("User not found");
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
  }

  async appendAudit(input: AuditInput) {
    this.audits.push(input);
  }

  expireAllSessions() {
    for (const session of this.sessions.values()) {
      session.expiresAt = new Date(0);
    }
  }
}
