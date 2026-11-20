import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { AppEnv } from "../../config/env.js";
import { AdministrationError, type UserService } from "../users/user.service.js";
import { AuthError, publicUser, type AuthService } from "./auth.service.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_POLICY_HINT } from "./password-policy.js";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./session.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
});

const registrationSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  confirmPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  inviteCode: z.string().trim().max(128).optional()
}).refine((input) => input.password === input.confirmPassword, {
  message: "两次输入的密码不一致",
  path: ["confirmPassword"]
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH)
});

export interface AuthRoutesOptions {
  env: AppEnv;
  authService: AuthService;
  userService: UserService;
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError || error instanceof AdministrationError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: PASSWORD_POLICY_HINT });
  }
  throw error;
}

function matchesInviteCode(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const inviteCode = options.env.REGISTRATION_INVITE_CODE?.trim() || "";
  // SEC-03：完全开放模式（REGISTRATION_OPEN=true）无需邀请码；两种模式注册后均为停用状态，须管理员启用。
  const registrationOpen = Boolean(inviteCode) || options.env.REGISTRATION_OPEN;

  // 前端注册页据此展示"需邀请码"或"无需邀请码"，不暴露邀请码本身。
  app.get("/api/auth/registration-mode", async () => ({
    open: registrationOpen,
    inviteRequired: Boolean(inviteCode),
    passwordPolicy: PASSWORD_POLICY_HINT
  }));

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        // SEC-03：默认关闭自助注册，员工一律由管理员建号。
        if (!registrationOpen) {
          return reply.code(403).send({ code: "REGISTRATION_CLOSED", message: "暂未开放自助注册，请联系管理员开通账号" });
        }
        const { confirmPassword: _confirmPassword, inviteCode: providedInvite, ...input } = registrationSchema.parse(request.body);
        if (inviteCode && !matchesInviteCode(providedInvite, inviteCode)) {
          return reply.code(403).send({ code: "INVITE_CODE_INVALID", message: "注册邀请码无效，请向人事或管理员索取" });
        }
        // SEC-02/03：无论是否发生用户名冲突，响应完全一致，不再泄露账号存在性。
        await options.userService.registerEmployee(input);
        return reply.code(202).send({ ok: true, message: "注册申请已提交，请等待管理员审核并启用账号" });
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post(
    "/api/auth/login",
    {
      config: {
        rateLimit: {
          // SEC-05：限流维度由"仅 IP"收紧为"IP + 账号"，
          // 避免同一来源对大量账号轮询试错；账号级锁定仍在服务层生效。
          max: 10,
          timeWindow: "1 minute",
          // 默认在 onRequest 阶段执行，此时 body 尚未解析，按账号分桶会退化为仅按 IP。
          hook: "preHandler",
          keyGenerator: (request) => {
            const body = request.body as { username?: unknown } | undefined;
            const username = typeof body?.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
            return `${request.ip}|${username}`;
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const input = loginSchema.parse(request.body);
        const result = await options.authService.login(input.username, input.password, request.ip);
        reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
          httpOnly: true,
          secure: options.env.COOKIE_SECURE,
          sameSite: "lax",
          path: "/",
          maxAge: Math.floor(SESSION_DURATION_MS / 1000)
        });
        return {
          user: publicUser(result.user),
          csrfToken: result.csrfToken
        };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.get("/api/auth/me", { preHandler: app.requireUser }, async (request) => ({
    user: publicUser(request.authenticated!.user),
    csrfToken: request.authenticated!.session.csrfSecret
  }));

  app.post(
    "/api/auth/change-initial-password",
    { preHandler: app.requireUser },
    async (request, reply) => {
      try {
        const input = passwordChangeSchema.parse(request.body);
        const authenticated = request.authenticated!;
        options.authService.verifyCsrf(authenticated, request.headers["x-csrf-token"] as string | undefined);
        // SEC-10：改密后轮换 CSRF Token，并把新 Token 交还前端。
        const result = await options.authService.changeInitialPassword(
          authenticated,
          input.currentPassword,
          input.newPassword,
          request.ip
        );
        return { ok: true, csrfToken: result.csrfToken };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  // FUNC-02：普通用户自助改密，成功后吊销其它会话，当前会话保持有效。
  app.post(
    "/api/auth/change-password",
    { preHandler: app.requireUser },
    async (request, reply) => {
      try {
        const input = passwordChangeSchema.parse(request.body);
        const authenticated = request.authenticated!;
        options.authService.verifyCsrf(authenticated, request.headers["x-csrf-token"] as string | undefined);
        const result = await options.authService.changePassword(
          authenticated,
          input.currentPassword,
          input.newPassword,
          request.ip
        );
        return { ok: true, csrfToken: result.csrfToken };
      } catch (error) {
        return sendAuthError(reply, error);
      }
    }
  );

  app.post("/api/auth/logout", { preHandler: app.requireUser }, async (request, reply) => {
    try {
      const authenticated = request.authenticated!;
      options.authService.verifyCsrf(authenticated, request.headers["x-csrf-token"] as string | undefined);
      await options.authService.logout(authenticated, request.ip);
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });
};
