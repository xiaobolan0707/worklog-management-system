import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { AuthError, type AuthService } from "../auth/auth.service.js";
import { PersonnelError, type PersonnelService } from "./personnel.service.js";

const idParams = z.object({ id: z.string().min(1).max(191) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const updateSchema = z.object({ hireDate: date, departureDate: date, employmentStatus: z.enum(["ACTIVE", "DEPARTED"]), handoverManagerId: z.string().min(1).max(191).optional() }).strict();

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof PersonnelError || error instanceof AuthError) return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  if (error instanceof z.ZodError) return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查任职信息及确认内容" });
  throw error;
}

export const personnelRoutes: FastifyPluginAsync<{ personnelService: PersonnelService; authService: AuthService }> = async (app, { personnelService: service, authService }) => {
  const hr = app.requireRole("HR");
  const management = app.requireRole("MANAGEMENT");
  app.get("/api/hr/personnel", { preHandler: hr }, async (request, reply) => {
    try { return await service.list(request.authenticated!.user); } catch (error) { return sendError(reply, error); }
  });
  app.patch("/api/hr/personnel/:id", { preHandler: hr }, async (request, reply) => {
    try {
      authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string | undefined);
      const { id } = idParams.parse(request.params);
      return { employee: await service.update(request.authenticated!.user, id, updateSchema.parse(request.body)) };
    } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/hr/personnel/:id/number", { preHandler: hr }, async (request, reply) => {
    try {
      authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string | undefined);
      const { id } = idParams.parse(request.params);
      return { employee: await service.allocateNumber(request.authenticated!.user, id) };
    } catch (error) { return sendError(reply, error); }
  });
  app.get("/api/recycle-bin", { preHandler: management }, async (request, reply) => {
    try { return await service.listRecycleBin(request.authenticated!.user); } catch (error) { return sendError(reply, error); }
  });
  app.post("/api/recycle-bin/:id/restore", { preHandler: management }, async (request, reply) => {
    try {
      authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string | undefined);
      const { id } = idParams.parse(request.params);
      return { employee: await service.restore(request.authenticated!.user, id) };
    } catch (error) { return sendError(reply, error); }
  });
  app.delete("/api/recycle-bin/:id", { preHandler: management }, async (request, reply) => {
    try {
      authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string | undefined);
      z.object({ confirm: z.literal(true) }).strict().parse(request.body);
      const { id } = idParams.parse(request.params);
      await service.purge(request.authenticated!.user, id);
      return reply.code(204).send();
    } catch (error) { return sendError(reply, error); }
  });
};
