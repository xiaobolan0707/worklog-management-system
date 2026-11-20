import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import { PlanError, type PlanService } from "./plan.service.js";

const rangeQuery = z.object({ from: z.iso.date(), to: z.iso.date() });
const dateParams = z.object({ date: z.iso.date() });
const idParams = z.object({ id: z.string().min(1).max(191) });
const planBody = z.object({
  target: z.string().trim().min(1).max(500),
  dueAt: z.iso.datetime().nullable().optional()
});
const rateBody = z.object({
  rating: z.enum(["MET", "DELAYED", "UNMET"]),
  note: z.string().trim().max(500).optional()
});
const pendingQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10)
});
const leaderboardQuery = z.object({
  periodType: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  referenceDate: z.iso.date()
});

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof PlanError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查计划内容或评星参数" });
  }
  throw error;
}

export const planRoutes: FastifyPluginAsync<{
  planService: PlanService;
  authService: AuthService;
}> = async (app, options) => {
  const employeeOnly = app.requireRole("EMPLOYEE");
  const reviewer = app.requireRole("LEADER", "MANAGEMENT", "ADMIN");
  const csrf = (request: FastifyRequest) =>
    options.authService.verifyCsrf(
      request.authenticated!,
      request.headers["x-csrf-token"] as string | undefined
    );

  app.get("/api/plans/mine", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      const input = rangeQuery.parse(request.query);
      return { plans: await options.planService.listMine(request.authenticated!.user.id, input.from, input.to) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put("/api/plans/mine/:date", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      csrf(request);
      const { date } = dateParams.parse(request.params);
      const input = planBody.parse(request.body);
      return { plan: await options.planService.saveMine(request.authenticated!.user.id, date, input) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/plans/mine/:date/submit", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      csrf(request);
      const { date } = dateParams.parse(request.params);
      return { plan: await options.planService.submit(request.authenticated!.user.id, date) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/plans/pending", { preHandler: reviewer }, async (request, reply) => {
    try {
      const { page, pageSize } = pendingQuery.parse(request.query);
      const actor = request.authenticated!.user;
      const plans = await options.planService.listPending(actor.id, actor.role);
      const start = (page - 1) * pageSize;
      return { plans: plans.slice(start, start + pageSize), total: plans.length, page, pageSize };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/api/plans/:id/rate", { preHandler: reviewer }, async (request, reply) => {
    try {
      csrf(request);
      const { id } = idParams.parse(request.params);
      const input = rateBody.parse(request.body);
      const actor = request.authenticated!.user;
      return { plan: await options.planService.rate(id, actor.id, actor.role, input.rating, input.note) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/api/reports/plan-leaderboard", { preHandler: app.requireUser }, async (request, reply) => {
    try {
      const input = leaderboardQuery.parse(request.query);
      return { leaderboard: await options.planService.leaderboard(input.periodType, input.referenceDate) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
