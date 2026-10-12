import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import { ApprovalError, type ApprovalService } from "./approval.service.js";
import { approvalDecisionSchema, colorChangeSchema, returnSchema } from "./approval.schemas.js";

const paramsSchema = z.object({ logId: z.string().min(1).max(191) });

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
  const csrf = (request: Parameters<typeof options.authService.verifyCsrf>[0] extends never ? never : any) =>
    options.authService.verifyCsrf(
      request.authenticated,
      request.headers["x-csrf-token"] as string | undefined
    );

  app.get("/api/approvals/pending", { preHandler: leaderOnly }, async (request) => ({
    logs: await options.approvalService.listPending(request.authenticated!.user.id)
  }));

  app.post("/api/approvals/:logId/approve", { preHandler: leaderOnly }, async (request, reply) => {
    try {
      csrf(request);
      const { logId } = paramsSchema.parse(request.params);
      const input = approvalDecisionSchema.parse(request.body);
      return {
        log: await options.approvalService.approveCurrentStep(
          logId,
          request.authenticated!.user.id,
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
          request.authenticated!.user.id,
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
          request.authenticated!.user.id,
          input.color,
          input.reason
        )
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
