import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import { ApprovalError, type ApprovalActor, type ApprovalService } from "./approval.service.js";
import { approvalDecisionSchema, colorChangeSchema, returnSchema } from "./approval.schemas.js";

const paramsSchema = z.object({ logId: z.string().min(1).max(191) });
// PERF-03：待审队列分页，避免一次渲染上百封信纸卡片把浏览器卡死。
const pendingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10)
});

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ApprovalError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查审批内容" });
  }
  throw error;
}

export const approvalRoutes: FastifyPluginAsync<{
  approvalService: ApprovalService;
  authService: AuthService;
}> = async (app, options) => {
  const leaderOnly = app.requireRole("LEADER", "MANAGEMENT", "ADMIN");
  // 审批范围由角色 + 本部门决定：管理层/管理员全公司，领导本部门（见 canActOnStep）。
  const actorOf = (request: Parameters<typeof app.requireUser>[0]): ApprovalActor => {
    const user = request.authenticated!.user;
    return { id: user.id, role: user.role as ApprovalActor["role"], departmentId: user.departmentId ?? null };
  };
  const csrf = (request: Parameters<typeof options.authService.verifyCsrf>[0] extends never ? never : any) =>
    options.authService.verifyCsrf(
      request.authenticated,
      request.headers["x-csrf-token"] as string | undefined
    );

  app.get("/api/approvals/pending", { preHandler: leaderOnly }, async (request) => {
    const { page, pageSize } = pendingQuerySchema.parse(request.query);
    const pending = await options.approvalService.listPending(actorOf(request));
    const start = (page - 1) * pageSize;
    return {
      logs: pending.slice(start, start + pageSize),
      total: pending.length,
      page,
      pageSize
    };
  });

  app.post("/api/approvals/:logId/approve", { preHandler: leaderOnly }, async (request, reply) => {
    try {
      csrf(request);
      const { logId } = paramsSchema.parse(request.params);
      const input = approvalDecisionSchema.parse(request.body);
      return {
        log: await options.approvalService.approveCurrentStep(
          logId,
          actorOf(request),
          input.color,
          input.itemComments
        )
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/approvals/:logId/return", { preHandler: leaderOnly }, async (request, reply) => {
    try {
      csrf(request);
      const { logId } = paramsSchema.parse(request.params);
      const { itemComments } = returnSchema.parse(request.body);
      return {
        log: await options.approvalService.returnCurrentStep(
          logId,
          actorOf(request),
          itemComments
        )
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/logs/:logId/change-color", { preHandler: leaderOnly }, async (request, reply) => {
    try {
      csrf(request);
      const { logId } = paramsSchema.parse(request.params);
      const input = colorChangeSchema.parse(request.body);
      return {
        log: await options.approvalService.changeReviewedColor(
          logId,
          actorOf(request),
          input.color,
          input.reason
        )
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
