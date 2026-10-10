import type { PrismaClient } from "../../generated/prisma/client.js";
import { appendAudit, type AuditInput } from "../audit/audit.repository.js";
import type { PeriodType } from "./report.service.js";

export function recommendReward(counts: { redCount: number; grayCount: number }) {
  return counts.grayCount > 0 && counts.grayCount >= counts.redCount ? "IMPROVEMENT" as const : "REWARD" as const;
}

export interface RewardInput {
  employeeId: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  redCount: number;
  grayCount: number;
  note?: string | undefined;
}

export interface RewardRepository {
  canConfirm(actorId: string, employeeId: string): Promise<boolean>;
  saveDecision(input: RewardInput & { decidedById: string; outcome: "REWARD" | "IMPROVEMENT" }): Promise<unknown>;
  appendAudit(input: AuditInput): Promise<void>;
}

export class RewardError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export class RewardService {
  constructor(private readonly repository: RewardRepository) {}

  async confirm(actorId: string, input: RewardInput) {
    if (!(await this.repository.canConfirm(actorId, input.employeeId))) {
      throw new RewardError(403, "FORBIDDEN", "无权确认该员工的奖惩结果");
    }
    const outcome = recommendReward(input);
    const decision = await this.repository.saveDecision({ ...input, decidedById: actorId, outcome });
    await this.repository.appendAudit({
      actorId,
      subjectUserId: input.employeeId,
      action: "REWARD_DECISION_CONFIRMED",
      entityType: "RewardDecision",
      entityId: `${input.employeeId}:${input.periodType}:${input.periodStart}`,
      metadata: { outcome, redCount: input.redCount, grayCount: input.grayCount }
    });
    return decision;
  }
}

export class PrismaRewardRepository implements RewardRepository {
  constructor(private readonly database: PrismaClient) {}

  async canConfirm(actorId: string, employeeId: string) {
    const actor = await this.database.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (actor?.role === "ADMIN" || actor?.role === "MANAGEMENT") return true;
    return Boolean(await this.database.employeeApprover.findUnique({
      where: { employeeId_approverId: { employeeId, approverId: actorId } }
    }));
  }

  saveDecision(input: RewardInput & { decidedById: string; outcome: "REWARD" | "IMPROVEMENT" }) {
    return this.database.rewardDecision.upsert({
      where: {
        employeeId_periodType_periodStart_periodEnd: {
          employeeId: input.employeeId,
          periodType: input.periodType,
          periodStart: new Date(`${input.periodStart}T00:00:00.000Z`),
          periodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`)
        }
      },
      create: {
        employeeId: input.employeeId,
        decidedById: input.decidedById,
        periodType: input.periodType,
        periodStart: new Date(`${input.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
        redCount: input.redCount,
        grayCount: input.grayCount,
        outcome: input.outcome,
        note: input.note ?? null
      },
      update: {
        decidedById: input.decidedById,
        redCount: input.redCount,
        grayCount: input.grayCount,
        outcome: input.outcome,
        note: input.note ?? null,
        decidedAt: new Date()
      }
    });
  }

  async appendAudit(input: AuditInput) {
    await this.database.$transaction(async (transaction) => appendAudit(transaction, input));
  }
}
