import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import type { AppEnv } from "../../config/env.js";
import { AuthError, publicUser, type AuthService } from "./auth.service.js";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "./session.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256)
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256)
});

export interface AuthRoutesOptions {
  env: AppEnv;
  authService: AuthService;
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查输入内容" });
  }
  throw error;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
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
    user: publicUser(request.authenticated!.user)
  }));

  app.post(
    "/api/auth/change-initial-password",
    { preHandler: app.requireUser },
    async (request, reply) => {
      try {
        const input = passwordChangeSchema.parse(request.body);
        const authenticated = request.authenticated!;
        options.authService.verifyCsrf(authenticated, request.headers["x-csrf-token"] as string | undefined);
        await options.authService.changeInitialPassword(
          authenticated,
          input.currentPassword,
          input.newPassword,
          request.ip
        );
        return { ok: true };
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
