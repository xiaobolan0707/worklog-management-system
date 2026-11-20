import { timingSafeEqual } from "node:crypto";

import type { AuthRepository, AuthSessionRecord, AuthUserRecord } from "./auth.repository.js";
import { hashPassword, verifyPassword } from "./password.js";
import { passwordStrengthError } from "./password-policy.js";
import { createOpaqueToken, hashSessionToken, SESSION_DURATION_MS } from "./session.js";
import { assertAccountAccessible } from "./account-lifecycle.js";

const MAX_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * SEC-02：固定的哑口令哈希。
 * 用户不存在、账号被锁定等分支也执行一次等成本的 scrypt 校验，
 * 使响应耗时无法用于推断账号是否存在。
 */
const DUMMY_PASSWORD_HASH =
  "scrypt:d29ya2xvZy1kdW1teS1zYWx0:1JEbmCZeap3LZ7eG2HdFSDMCEiBMWGlqLJ7N5Meq74KDQ3EVKISrXmIAyH9GHwb3MFY3XFiPaVMjekWiQdQRWQ";

const INVALID_CREDENTIALS_MESSAGE = "用户名或密码错误";

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
    mustChangePassword: user.mustChangePassword,
    employmentStatus: user.employmentStatus ?? "ACTIVE"
  };
}

export class AuthService {
  private readonly sessionSecret: string;

  constructor(
    private readonly repository: AuthRepository,
    private readonly now: () => Date = () => new Date(),
    sessionSecret?: string
  ) {
    const resolved = sessionSecret ?? process.env.SESSION_SECRET;
    if (resolved) {
      this.sessionSecret = resolved;
    } else if (process.env.NODE_ENV === "production") {
      // 生产环境必须显式提供密钥，禁止回退到内置值。
      throw new Error("SESSION_SECRET is required in production");
    } else {
      this.sessionSecret = "worklog-non-production-session-secret";
    }
  }

  private tokenHash(token: string): string {
    return hashSessionToken(token, this.sessionSecret);
  }

  private async consumeDummyHash(password: string): Promise<void> {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
  }

  private invalidCredentials(): AuthError {
    return new AuthError(401, "INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE);
  }

  async login(usernameInput: string, password: string, ipAddress: string | null): Promise<LoginResult> {
    const username = usernameInput.trim();
    const user = await this.repository.findUserByUsername(username);

    if (!user) {
      // 不存在的账号同样付出一次哈希成本，且响应体与密码错误完全一致。
      await this.consumeDummyHash(password);
      await this.repository.recordLoginAttempt({ username, userId: null, ipAddress, outcome: "FAILURE" });
      throw this.invalidCredentials();
    }

    const now = this.now();
    if (user.accountStatus === "DISABLED") {
      await this.consumeDummyHash(password);
      await this.repository.recordLoginAttempt({ username, userId: user.id, ipAddress, outcome: "FAILURE" });
      throw new AuthError(403, "ACCOUNT_DISABLED", "账号已停用");
    }
    assertAccountAccessible(user, now);

    const locked = Boolean(user.lockedUntil && user.lockedUntil > now);
    // 无论是否处于锁定期都执行真实校验，保证时序一致。
    const passwordValid = await verifyPassword(password, user.passwordHash);

    if (locked) {
      await this.repository.recordLoginAttempt({ username, userId: user.id, ipAddress, outcome: "LOCKED" });
      if (!passwordValid) {
        // SEC-02：攻击者持错误密码时，锁定账号与不存在账号的响应不可区分；
        // 锁定期内不采纳密码、不累加计数、不延长锁定，暴力破解在此期间无效。
        throw this.invalidCredentials();
      }
      // 只有持有正确密码的本人才会看到锁定提示，避免泄露账号存在性。
      throw new AuthError(423, "ACCOUNT_LOCKED", "登录失败次数过多，账号已临时锁定，请稍后再试或联系管理员重置密码");
    }

    if (!passwordValid) {
      // FUNC-01：锁定期已结束则重新计数，避免"到期后输错一次立即再锁"。
      const previousLockExpired = Boolean(user.lockedUntil && user.lockedUntil <= now);
      const nextCount = previousLockExpired ? 1 : user.failedLoginCount + 1;
      const shouldLock = nextCount >= MAX_FAILURES;
      await this.repository.recordFailedLogin(
        user.id,
        shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
        previousLockExpired
      );
      await this.repository.recordLoginAttempt({
        username,
        userId: user.id,
        ipAddress,
        outcome: shouldLock ? "LOCKED" : "FAILURE"
      });
      throw this.invalidCredentials();
    }

    await this.repository.resetLoginFailures(user.id);
    await this.repository.recordLoginAttempt({ username, userId: user.id, ipAddress, outcome: "SUCCESS" });
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const session = await this.repository.createSession({
      userId: user.id,
      tokenHash: this.tokenHash(sessionToken),
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
    const session = await this.repository.findSessionByTokenHash(this.tokenHash(sessionToken));
    if (!session || session.revokedAt) {
      throw new AuthError(401, "UNAUTHENTICATED", "会话无效，请重新登录");
    }
    if (session.expiresAt <= this.now()) {
      throw new AuthError(401, "SESSION_EXPIRED", "会话已过期，请重新登录");
    }
    const user = await this.repository.findUserById(session.userId);
    if (!user) throw new AuthError(401, "UNAUTHENTICATED", "会话无效，请重新登录");
    assertAccountAccessible(user, this.now());
    if (user.accountStatus === "DISABLED") {
      throw new AuthError(403, "ACCOUNT_DISABLED", "账号已停用");
    }
    return { session, user };
  }

  /** SEC-10：常量时间比较，避免时序侧信道。 */
  verifyCsrf(authenticated: AuthenticatedSession, csrfToken: string | undefined) {
    const expected = Buffer.from(authenticated.session.csrfSecret ?? "", "utf8");
    const provided = Buffer.from(csrfToken ?? "", "utf8");
    if (!csrfToken || expected.length === 0 || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new AuthError(403, "CSRF_INVALID", "请求验证失败，请刷新页面后重试");
    }
  }

  private assertNewPassword(user: AuthUserRecord, newPassword: string, currentPassword: string) {
    if (newPassword === currentPassword) {
      throw new AuthError(400, "PASSWORD_TOO_WEAK", "新密码不能与当前密码相同");
    }
    const weakness = passwordStrengthError({
      password: newPassword,
      username: user.username,
      displayName: user.displayName
    });
    if (weakness) throw new AuthError(400, "PASSWORD_TOO_WEAK", weakness);
  }

  /** 改密后轮换 CSRF 并吊销其它会话，返回新的 CSRF Token 供前端更新。 */
  private async finishPasswordChange(
    authenticated: AuthenticatedSession,
    action: "INITIAL_PASSWORD_CHANGED" | "PASSWORD_CHANGED",
    ipAddress: string | null
  ): Promise<{ csrfToken: string }> {
    await this.repository.revokeOtherSessions(authenticated.user.id, authenticated.session.id, this.now());
    const csrfToken = createOpaqueToken();
    await this.repository.rotateCsrfSecret(authenticated.session.id, csrfToken);
    authenticated.session.csrfSecret = csrfToken;
    await this.repository.appendAudit({
      actorId: authenticated.user.id,
      subjectUserId: authenticated.user.id,
      action,
      entityType: "User",
      entityId: authenticated.user.id,
      metadata: {},
      ipAddress
    });
    return { csrfToken };
  }

  async changeInitialPassword(
    authenticated: AuthenticatedSession,
    currentPassword: string,
    newPassword: string,
    ipAddress: string | null
  ): Promise<{ csrfToken: string }> {
    if (!authenticated.user.mustChangePassword) {
      throw new AuthError(409, "INITIAL_PASSWORD_ALREADY_CHANGED", "初始密码已修改");
    }
    if (!(await verifyPassword(currentPassword, authenticated.user.passwordHash))) {
      throw new AuthError(401, "CURRENT_PASSWORD_INVALID", "当前密码错误");
    }
    this.assertNewPassword(authenticated.user, newPassword, currentPassword);

    await this.repository.updateInitialPassword(
      authenticated.user.id,
      await hashPassword(newPassword)
    );
    return this.finishPasswordChange(authenticated, "INITIAL_PASSWORD_CHANGED", ipAddress);
  }

  /** FUNC-02：普通用户自助改密，无需再走管理员重置。 */
  async changePassword(
    authenticated: AuthenticatedSession,
    currentPassword: string,
    newPassword: string,
    ipAddress: string | null
  ): Promise<{ csrfToken: string }> {
    const user = await this.repository.findUserById(authenticated.user.id);
    if (!user) throw new AuthError(401, "UNAUTHENTICATED", "会话无效，请重新登录");
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new AuthError(401, "CURRENT_PASSWORD_INVALID", "当前密码错误");
    }
    this.assertNewPassword(user, newPassword, currentPassword);

    await this.repository.updatePasswordHash(user.id, await hashPassword(newPassword));
    return this.finishPasswordChange(authenticated, "PASSWORD_CHANGED", ipAddress);
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
