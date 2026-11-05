import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/auth.service.js";
import { sendAdministrationError } from "../users/user.routes.js";
import type { ArchiveService } from "./archive.service.js";

const params = z.object({ id: z.string().min(1).max(191), attachmentId: z.string().min(1).max(191).optional() });
const profile = z.object({ displayName: z.string().trim().min(1).max(100), gender: z.enum(["MALE", "FEMALE", "UNDISCLOSED"]) }).strict();
const upload = z.object({ category: z.enum(["RESUME", "DEGREE", "AGREEMENT"]), name: z.string().min(1).max(200), data: z.string().min(1).max(14_000_000) }).strict();

export const archiveRoutes: FastifyPluginAsync<{ archiveService: ArchiveService; authService: AuthService }> = async (app, { archiveService, authService }) => {
  const roles = app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT");
  const management = app.requireRole("MANAGEMENT");
  app.get("/api/archives", { preHandler: roles }, async (request, reply) => {
    try { return await archiveService.list(request.authenticated!.user); } catch (error) { return sendAdministrationError(reply, error); }
  });
  app.get("/api/archives/:id", { preHandler: roles }, async (request, reply) => {
    try { return await archiveService.get(request.authenticated!.user, params.parse(request.params).id); } catch (error) { return sendAdministrationError(reply, error); }
  });
  app.patch("/api/archives/:id", { preHandler: roles }, async (request, reply) => {
    try { authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string); return await archiveService.update(request.authenticated!.user, params.parse(request.params).id, profile.parse(request.body)); }
    catch (error) { return sendAdministrationError(reply, error, "请填写姓名与性别，仅可修改本人的个人资料"); }
  });
  app.post("/api/archives/:id/attachments", { preHandler: roles, bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
    try { authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string); return reply.code(201).send(await archiveService.upload(request.authenticated!.user, params.parse(request.params).id, upload.parse(request.body))); }
    catch (error) { return sendAdministrationError(reply, error, "请上传不超过 10MB 的有效附件"); }
  });
  app.delete("/api/archives/:id/attachments/:attachmentId", { preHandler: roles }, async (request, reply) => {
    try { authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string); const input = params.required().parse(request.params); return await archiveService.remove(request.authenticated!.user, input.id, input.attachmentId); }
    catch (error) { return sendAdministrationError(reply, error); }
  });
  for (const bin of [false, true]) {
    app.get(bin ? "/api/recycle-bin/:id/attachments/:attachmentId" : "/api/archives/:id/attachments/:attachmentId", { preHandler: bin ? management : roles }, async (request, reply) => {
      try {
        const input = params.required().parse(request.params);
        const file = await archiveService.download(request.authenticated!.user, input.id, input.attachmentId, bin);
        return reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").header("Content-Type", file.mimeType)
          .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`).send(file.data);
      } catch (error) { return sendAdministrationError(reply, error); }
    });
  }
  app.get("/api/recycle-bin/:id/archive", { preHandler: management }, async (request, reply) => {
    try { return await archiveService.get(request.authenticated!.user, params.parse(request.params).id, true); } catch (error) { return sendAdministrationError(reply, error); }
  });
  app.get("/api/recycle-bin/:id/logs", { preHandler: management }, async (request, reply) => {
    try { return await archiveService.recycledLogs(request.authenticated!.user, params.parse(request.params).id); } catch (error) { return sendAdministrationError(reply, error); }
  });
};
