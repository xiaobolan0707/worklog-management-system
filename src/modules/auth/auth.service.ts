import type { AuthRepository, AuthSessionRecord, AuthUserRecord } from "./auth.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createOpaqueToken, hashSessionToken, SESSION_DURATION_MS } from "./session.js";

const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export interface AuthenticatedSession {
  session: AuthSessionRecord;
  user: AuthUserRecord;
}

export interface LoginResult extends AuthenticatedSession {
  sessionToken: string;
  csrfToken: string;
}

export function publicUser(user: AuthUserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword
  };
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async login(usernameInput: string, password: string, ipAddress: string | null): Promise<LoginResult> {
    const username = usernameInput.trim();
    const user = await this.repository.findUserByUsername(username);

    if (!user) {
      await this.repository.recordLoginAttempt({ username, userId: null, ipAddress, outcome: "FAILURE" });
      throw new AuthError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    const now = this.now();
    if (user.accountStatus === "DISABLED") {
      await this.repository.recordLoginAttempt({ username, userId: user.id, ipAddress, outcome: "FAILURE" });
      throw new AuthError(403, "ACCOUNT_DISABLED", "账号已停用");
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.repository.recordLoginAttempt({ username, userId: user.id, ipAddress, outcome: "LOCKED" });
      throw new AuthError(423, "ACCOUNT_LOCKED", "登录失败次数过多，请稍后再试");
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      const shouldLock = user.failedLoginCount + 1 >= MAX_FAILURES;
      await this.repository.recordFailedLogin(
        user.id,
        shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null
      );
      await this.repository.recordLoginAttempt({
        username,
        userId: user.id,
        ipAddress,
        outcome: shouldLock ? "LOCKED" : "FAILURE"
      });
      throw new AuthError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    await this.repository.resetLoginFailures(user.id);
    await this.repository.recordLoginAttempt({ username, userId: user.id, ipAddress, outcome: "SUCCESS" });
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const session = await this.repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      csrfSecret: csrfToken,
      expiresAt: new Date(now.getTime() + SESSION_DURATION_MS)
    });
    await this.repository.appendAudit({
      actorId: user.id,
      subjectUserId: user.id,
      action: "AUTH_LOGIN",
      entityType: "Session",
      entityId: session.id,
      metadata: {},
      ipAddress
    });

    return { user: { ...user, failedLoginCount: 0, lockedUntil: null }, session, sessionToken, csrfToken };
  }

  async authenticate(sessionToken: string | undefined): Promise<AuthenticatedSession> {
    if (!sessionToken) throw new AuthError(401, "UNAUTHENTICATED", "请先登录");
    const session = await this.repository.findSessionByTokenHash(hashSessionToken(sessionToken));
    if (!session || session.revokedAt) {
      throw new AuthError(401, "UNAUTHENTICATED", "会话无效，请重新登录");
    }
    if (session.expiresAt <= this.now()) {
      throw new AuthError(401, "SESSION_EXPIRED", "会话已过期，请重新登录");
    }
    const user = await this.repository.findUserById(session.userId);
    if (!user) throw new AuthError(401, "UNAUTHENTICATED", "会话无效，请重新登录");
    if (user.accountStatus === "DISABLED") {
      throw new AuthError(403, "ACCOUNT_DISABLED", "账号已停用");
    }
    return { session, user };
  }

  verifyCsrf(authenticated: AuthenticatedSession, csrfToken: string | undefined) {
    if (!csrfToken || csrfToken !== authenticated.session.csrfSecret) {
      throw new AuthError(403, "CSRF_INVALID", "请求验证失败，请刷新页面后重试");
    }
  }

  async changeInitialPassword(
    authenticated: AuthenticatedSession,
    currentPassword: string,
    newPassword: string,
    ipAddress: string | null
  ) {
    if (!authenticated.user.mustChangePassword) {
      throw new AuthError(409, "INITIAL_PASSWORD_ALREADY_CHANGED", "初始密码已修改");
    }
    if (!(await verifyPassword(currentPassword, authenticated.user.passwordHash))) {
      throw new AuthError(401, "CURRENT_PASSWORD_INVALID", "当前密码错误");
    }
    if (newPassword.length < 12 || newPassword === currentPassword) {
      throw new AuthError(400, "PASSWORD_TOO_WEAK", "新密码至少 12 位且不能与初始密码相同");
    }

    await this.repository.updateInitialPassword(
      authenticated.user.id,
      await hashPassword(newPassword)
    );
    await this.repository.appendAudit({
      actorId: authenticated.user.id,
      subjectUserId: authenticated.user.id,
      action: "INITIAL_PASSWORD_CHANGED",
      entityType: "User",
      entityId: authenticated.user.id,
      metadata: {},
      ipAddress
    });
  }

  async logout(authenticated: AuthenticatedSession, ipAddress: string | null) {
    const revokedAt = this.now();
    await this.repository.revokeSession(authenticated.session.id, revokedAt);
    await this.repository.appendAudit({
      actorId: authenticated.user.id,
      subjectUserId: authenticated.user.id,
      action: "AUTH_LOGOUT",
      entityType: "Session",
      entityId: authenticated.session.id,
      metadata: {},
      ipAddress
    });
  }
}
