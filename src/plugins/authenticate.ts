import fp from "fastify-plugin";
import type { FastifyPluginAsync, preHandlerHookHandler } from "fastify";

import type { AuthRole } from "../modules/auth/auth.repository.js";
import { AuthError, type AuthenticatedSession, type AuthService } from "../modules/auth/auth.service.js";
import { SESSION_COOKIE_NAME } from "../modules/auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticated: AuthenticatedSession | null;
  }

  interface FastifyInstance {
    requireUser: preHandlerHookHandler;
    requireRole: (...roles: AuthRole[]) => preHandlerHookHandler;
  }
}

export interface AuthenticatePluginOptions {
  authService: AuthService;
}

const authenticatePluginImplementation: FastifyPluginAsync<AuthenticatePluginOptions> = async (
  app,
  options
) => {
  app.decorateRequest("authenticated", null);
  const authenticateRequest: preHandlerHookHandler = async (request, reply) => {
    try {
      request.authenticated = await options.authService.authenticate(
        request.cookies[SESSION_COOKIE_NAME]
      );
      const departed = request.authenticated.user.employmentStatus === "DEPARTED";
      const credentialAction = ["/api/auth/logout", "/api/auth/change-initial-password"].includes(request.url.split("?")[0]!);
      if (departed && !["GET", "HEAD"].includes(request.method) && !credentialAction) {
        return reply.code(403).send({ code: "DEPARTED_READ_ONLY", message: "离职后仅可查看本人资料和历史日志" });
      }
      if (departed && ["GET", "HEAD"].includes(request.method)) {
        const path = request.url.split("?")[0]!;
        const allowed = path === "/api/auth/me" || path === "/api/profile" || path === "/api/profile/departments" || path === "/api/logs/mine" ||
          path === "/api/reminders" || /^\/api\/logs\/[^/]+$/.test(path) || path.startsWith(`/api/archives/${request.authenticated.user.id}`);
        if (!allowed) return reply.code(403).send({ code: "DEPARTED_READ_ONLY", message: "离职后仅可查看本人资料和历史日志" });
      }
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  };
  app.decorate("requireUser", authenticateRequest);
  app.decorate("requireRole", (...roles: AuthRole[]) => async (request, reply) => {
    await authenticateRequest.call(app, request, reply, () => undefined);
    if (reply.sent || !request.authenticated) return;
    if (request.authenticated.user.mustChangePassword) {
      return reply.code(403).send({
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "首次登录需先修改初始密码"
      });
    }
    if (!roles.includes(request.authenticated.user.role)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "无权执行此操作" });
    }
  });
};

export const authenticatePlugin = fp(authenticatePluginImplementation, {
  name: "authenticate",
  dependencies: ["@fastify/cookie"]
});
