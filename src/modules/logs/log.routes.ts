import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import { LogError, type LogService } from "./log.service.js";
import { logDraftSchema } from "./log.schemas.js";

const idParams = z.object({ id: z.string().min(1).max(191) });
const imageParams = z.object({
  id: z.string().min(1).max(191),
  imageId: z.string().min(1).max(100)
});
const submitBody = z.object({ backfillReason: z.string().trim().min(1).max(100).optional() });
const replySchema = z.object({
  stepId: z.string().min(1).max(191),
  itemPosition: z.number().int().min(1).max(50),
  content: z.string().trim().min(1).max(1000)
});
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).default("")
});
// PERF-01：与 schemas 中"单条日志图片 ≤20MB（原始字节）"对应，base64 后约 27MB，留足余量。
const logBodyLimit = 32 * 1024 * 1024;

export interface LogRoutesOptions {
  logService: LogService;
  authService: AuthService;
}

function sendLogError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof LogError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    // 只回一句「请检查日志内容」对用户友好，但排障必须能定位字段：
    // 把 issue 的 path/message 记进日志，避免再次出现"只能靠猜"的线上问题。
    request.log.warn({
      issues: error.issues.slice(0, 5).map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message
      }))
    }, "log payload failed schema validation");
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查日志内容" });
  }
  throw error;
}

export const logRoutes: FastifyPluginAsync<LogRoutesOptions> = async (app, options) => {
  const employeeOnly = app.requireRole("EMPLOYEE");

  app.post("/api/logs/drafts", { preHandler: employeeOnly, bodyLimit: logBodyLimit }, async (request, reply) => {
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
      return sendLogError(request, reply, error);
    }
  });

  app.put("/api/logs/:id", { preHandler: employeeOnly, bodyLimit: logBodyLimit }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = idParams.parse(request.params);
      const input = logDraftSchema.parse(request.body);
      return { log: await options.logService.updateDraft(id, request.authenticated!.user.id, input) };
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  // FUNC-03：删除本人草稿，避免无效草稿永久滞留。
  app.delete("/api/logs/:id", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = idParams.parse(request.params);
      await options.logService.deleteDraft(id, request.authenticated!.user.id);
      return reply.code(204).send();
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  // PERF-01：历史版本按需加载，响应不再包含图片 base64 内容。
  app.get("/api/logs/:id/versions", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN") }, async (request, reply) => {
    try {
      const { id } = idParams.parse(request.params);
      return { versions: await options.logService.listVersions(request.authenticated!.user, id) };
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  app.post("/api/logs/:id/submit", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = idParams.parse(request.params);
      const { backfillReason } = submitBody.parse(request.body ?? {});
      return { log: await options.logService.submitLog(id, request.authenticated!.user.id, backfillReason) };
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  app.get("/api/logs/mine", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT") }, async (request, reply) => {
    try { return await options.logService.listMine(request.authenticated!.user.id, listQuery.parse(request.query)); }
    catch (error) { return sendLogError(request, reply, error); }
  });

  app.post("/api/logs/:id/replies", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!, request.headers["x-csrf-token"] as string | undefined
      );
      const { id } = idParams.parse(request.params);
      const { stepId, itemPosition, content } = replySchema.parse(request.body);
      const log = await options.logService.replyToComment(
        id, request.authenticated!.user.id, stepId, itemPosition, content
      );
      return reply.code(201).send({ log });
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  // PERF-03：列表只下发图片元数据，图片按需单独取，避免大响应体。
  // 权限沿用 getVisibleLog 的范围判定，缓存标记为 private，避免跨账号复用。
  app.get("/api/logs/:id/images/:imageId", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN") }, async (request, reply) => {
    try {
      const { id, imageId } = imageParams.parse(request.params);
      const image = await options.logService.getItemImage(request.authenticated!.user, id, imageId);
      const base64 = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
      return reply
        .header("Content-Type", image.type)
        .header("Cache-Control", "private, max-age=604800, immutable")
        .header("X-Content-Type-Options", "nosniff")
        .send(Buffer.from(base64, "base64"));
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  app.get("/api/logs/:id", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN") }, async (request, reply) => {
    try {
      const { id } = idParams.parse(request.params);
      return { log: await options.logService.getVisibleLog(request.authenticated!.user, id) };
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });

  app.get("/api/logs", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN") }, async (request, reply) => {
    try {
      return await options.logService.listVisible(request.authenticated!.user, listQuery.parse(request.query));
    } catch (error) {
      return sendLogError(request, reply, error);
    }
  });
};
