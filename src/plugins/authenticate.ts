import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, preHandlerHookHandler } from "fastify";

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

/** SEC-06：首次改密白名单。除此之外，待改密会话不得访问任何业务接口。 */
const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/change-initial-password",
  "/api/auth/logout"
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** SEC-10：写请求的第二道防线——校验 Origin/Referer 与 Host 同源。 */
function verifySameOrigin(request: FastifyRequest): boolean {
  const source = request.headers.origin ?? request.headers.referer;
  if (!source || source === "null") return true;
  const host = request.headers.host;
  if (!host) return true;
  try {
    return new URL(source).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
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
      const path = request.url.split("?")[0]!;
      const user = request.authenticated.user;

      if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED_PATHS.has(path)) {
        return reply.code(403).send({
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "首次登录需先修改初始密码"
        });
      }

      if (!SAFE_METHODS.has(request.method) && !verifySameOrigin(request)) {
        return reply.code(403).send({ code: "ORIGIN_INVALID", message: "请求来源不合法" });
      }

      const departed = user.employmentStatus === "DEPARTED";
      const credentialAction = ["/api/auth/logout", "/api/auth/change-initial-password"].includes(path);
      if (departed && !["GET", "HEAD"].includes(request.method) && !credentialAction) {
        return reply.code(403).send({ code: "DEPARTED_READ_ONLY", message: "离职后仅可查看本人资料和历史日志" });
      }
      if (departed && ["GET", "HEAD"].includes(request.method)) {
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
    if (!roles.includes(request.authenticated.user.role)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "无权执行此操作" });
    }
  });
};

export const authenticatePlugin = fp(authenticatePluginImplementation, {
  name: "authenticate",
  dependencies: ["@fastify/cookie"]
});
