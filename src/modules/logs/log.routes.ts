import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import { LogError, type LogService } from "./log.service.js";
import { logDraftSchema } from "./log.schemas.js";

const idParams = z.object({ id: z.string().min(1).max(191) });

export interface LogRoutesOptions {
  logService: LogService;
  authService: AuthService;
}

function sendLogError(reply: FastifyReply, error: unknown) {
  if (error instanceof LogError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查日志内容" });
  }
  throw error;
}

export const logRoutes: FastifyPluginAsync<LogRoutesOptions> = async (app, options) => {
  const employeeOnly = app.requireRole("EMPLOYEE");

  app.post("/api/logs/drafts", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const input = logDraftSchema.parse(request.body);
      const log = await options.logService.createOrUpdateDraft(
        request.authenticated!.user.id,
        input
      );
      return reply.code(201).send({ log });
    } catch (error) {
      return sendLogError(reply, error);
    }
  });

  app.put("/api/logs/:id", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = idParams.parse(request.params);
      const input = logDraftSchema.parse(request.body);
      return { log: await options.logService.updateDraft(id, request.authenticated!.user.id, input) };
    } catch (error) {
      return sendLogError(reply, error);
    }
  });

  app.post("/api/logs/:id/submit", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = idParams.parse(request.params);
      return { log: await options.logService.submitLog(id, request.authenticated!.user.id) };
    } catch (error) {
      return sendLogError(reply, error);
    }
  });

  app.get("/api/logs/mine", { preHandler: employeeOnly }, async (request) => ({
    logs: await options.logService.listMine(request.authenticated!.user.id)
  }));

  app.get("/api/logs/:id", { preHandler: app.requireUser }, async (request, reply) => {
    try {
      const { id } = idParams.parse(request.params);
      return { log: await options.logService.getVisibleLog(request.authenticated!.user, id) };
    } catch (error) {
      return sendLogError(reply, error);
    }
  });

  app.get("/api/logs", { preHandler: app.requireUser }, async (request, reply) => {
    try {
      return { logs: await options.logService.listVisible(request.authenticated!.user) };
    } catch (error) {
      return sendLogError(reply, error);
    }
  });
};
