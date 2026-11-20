import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import { AuthError, type AuthService } from "../auth/auth.service.js";
import type { ApproverService } from "../users/approver.service.js";
import { ReportService } from "./report.service.js";
import { RewardError, type RewardService } from "./reward.service.js";

const reportQuery = z.object({
  periodType: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  referenceDate: z.iso.date()
});
const rewardSchema = z.object({
  employeeId: z.string().min(1).max(191),
  periodType: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  note: z.string().trim().max(2000).optional()
});

export const reportRoutes: FastifyPluginAsync<{
  reportService: ReportService;
  rewardService: RewardService;
  approverService: ApproverService;
  authService: AuthService;
}> = async (app, options) => {
  async function employeeScope(request: Parameters<typeof app.requireUser>[0]) {
    const actor = request.authenticated!.user;
    if (actor.role === "EMPLOYEE") return [actor.id];
    if (actor.role === "LEADER") return options.approverService.listAuthorizedEmployeeIds(actor.id);
    return null;
  }

  const reportHandler = async (request: any, reply: FastifyReply) => {
    try {
      const input = reportQuery.parse(request.query);
      return {
        report: await options.reportService.buildPeriodStats(
          await employeeScope(request),
          input.periodType,
          input.referenceDate
        )
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查统计周期" });
      }
      throw error;
    }
  };

  app.get("/api/reports/employees", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN") }, reportHandler);
  app.get("/api/reports/departments", { preHandler: app.requireRole("LEADER", "MANAGEMENT", "ADMIN") }, reportHandler);
  // 产品口径：HR 需要全公司红灰统计（与其日志监督职责一致），与管理层同权；
  // LEADER 仍由 employeeScope 收敛到审批授权员工，不会看到其他部门。
  app.get("/api/reports/company", { preHandler: app.requireRole("LEADER", "MANAGEMENT", "ADMIN", "HR") }, reportHandler);
  // 排行榜统一走 plans 模块的 /api/reports/plan-leaderboard（工作计划评星口径）。
  // 这里不再保留基于 daily_logs 红灰定色的同名端点，避免两套口径混淆。

  app.post(
    "/api/rewards/confirm",
    { preHandler: app.requireRole("LEADER", "MANAGEMENT", "ADMIN") },
    async (request, reply) => {
      try {
        options.authService.verifyCsrf(
          request.authenticated!,
          request.headers["x-csrf-token"] as string | undefined
        );
        const input = rewardSchema.parse(request.body);
        return { decision: await options.rewardService.confirm(request.authenticated!.user.id, input) };
      } catch (error) {
        if (error instanceof RewardError || error instanceof AuthError) {
          return reply.code(error.statusCode).send({ code: error.code, message: error.message });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查奖惩确认内容" });
        }
        throw error;
      }
    }
  );
};
