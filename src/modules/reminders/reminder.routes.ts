import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import { ReminderError, type ReminderService } from "./reminder.service.js";

const paramsSchema = z.object({ id: z.string().min(1).max(191) });

export const reminderRoutes: FastifyPluginAsync<{
  reminderService: ReminderService;
  authService: AuthService;
}> = async (app, options) => {
  app.get("/api/reminders", { preHandler: app.requireUser }, async (request) => ({
    reminders: await options.reminderService.list(request.authenticated!.user.id)
  }));

  app.post("/api/reminders/:id/read", { preHandler: app.requireUser }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = paramsSchema.parse(request.params);
      return { reminder: await options.reminderService.markRead(request.authenticated!.user.id, id) };
    } catch (error) {
      if (error instanceof ReminderError || error instanceof AuthError) {
        return reply.code(error.statusCode).send({ code: error.code, message: error.message });
      }
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ code: "VALIDATION_ERROR", message: "无效的提醒编号" });
      }
      throw error;
    }
  });
};
