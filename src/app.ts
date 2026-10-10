import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppEnv } from "./config/env.js";
import { auditRoutes } from "./modules/audit/audit.routes.js";
import {
  AuditService,
  PrismaAuditQueryRepository,
  type AuditQueryRepository
} from "./modules/audit/audit.service.js";
import { PrismaAuthRepository, type AuthRepository } from "./modules/auth/auth.repository.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import {
  ApprovalService,
  PrismaApprovalRepository,
  type ApprovalRepository
} from "./modules/approvals/approval.service.js";
import { approvalRoutes } from "./modules/approvals/approval.routes.js";
import { PrismaLogRepository, type LogRepository } from "./modules/logs/log.repository.js";
import { logRoutes } from "./modules/logs/log.routes.js";
import { LogService } from "./modules/logs/log.service.js";
import { ReminderJobs } from "./modules/reminders/reminder.jobs.js";
import { reminderRoutes } from "./modules/reminders/reminder.routes.js";
import {
  PrismaReminderRepository,
  ReminderService,
  type ReminderRepository
} from "./modules/reminders/reminder.service.js";
import { reportRoutes } from "./modules/reports/report.routes.js";
import {
  PrismaReportRepository,
  ReportService,
  type ReportRepository
} from "./modules/reports/report.service.js";
import {
  PrismaRewardRepository,
  RewardService,
  type RewardRepository
} from "./modules/reports/reward.service.js";
import { settingRoutes } from "./modules/settings/setting.routes.js";
import { SettingService } from "./modules/settings/setting.service.js";
import { ApproverService } from "./modules/users/approver.service.js";
import { userRoutes } from "./modules/users/user.routes.js";
import {
  PrismaAdministrationRepository,
  UserService,
  type AdministrationRepository
} from "./modules/users/user.service.js";
import { authenticatePlugin } from "./plugins/authenticate.js";
import { csrfPlugin } from "./plugins/csrf.js";
import { createDatabase } from "./plugins/database.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { schedulerPlugin } from "./plugins/scheduler.js";

export interface BuildAppOptions {
  env: AppEnv;
  authRepository?: AuthRepository;
  administrationRepository?: AdministrationRepository;
  logRepository?: LogRepository;
  approvalRepository?: ApprovalRepository;
  reminderRepository?: ReminderRepository;
  reportRepository?: ReportRepository;
  rewardRepository?: RewardRepository;
  auditQueryRepository?: AuditQueryRepository;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.env.NODE_ENV !== "test" });
  const database = options.authRepository && options.administrationRepository && options.logRepository && options.approvalRepository && options.reminderRepository && options.reportRepository && options.rewardRepository && options.auditQueryRepository
    ? null
    : createDatabase(options.env);
  const authRepository = options.authRepository ?? new PrismaAuthRepository(database!);
  const administrationRepository = options.administrationRepository
    ?? new PrismaAdministrationRepository(database!);
  const logRepository = options.logRepository ?? new PrismaLogRepository(database!);
  const approvalRepository = options.approvalRepository ?? new PrismaApprovalRepository(database!);
  const reminderRepository = options.reminderRepository ?? new PrismaReminderRepository(database!);
  const reportRepository = options.reportRepository ?? new PrismaReportRepository(database!);
  const rewardRepository = options.rewardRepository ?? new PrismaRewardRepository(database!);
  const auditQueryRepository = options.auditQueryRepository ?? new PrismaAuditQueryRepository(database!);
  const authService = new AuthService(authRepository);
  const userService = new UserService(administrationRepository);
  const approverService = new ApproverService(administrationRepository);
  const settingService = new SettingService(administrationRepository);
  const logService = new LogService(logRepository, approverService);
  const approvalService = new ApprovalService(approvalRepository);
  const reminderService = new ReminderService(reminderRepository);
  const reportService = new ReportService(reportRepository);
  const rewardService = new RewardService(rewardRepository);
  const auditService = new AuditService(auditQueryRepository);
  const reminderSettings = options.env.NODE_ENV === "production"
    ? await settingService.get()
    : {
        submissionDeadline: "18:00",
        reminderMinutesBefore: 30,
        approvalDeadline: "12:00",
        timezone: "Asia/Shanghai" as const
      };
  const reminderJobs = new ReminderJobs(reminderService, reminderRepository, reminderSettings);

  if (database) {
    app.addHook("onClose", async () => database.$disconnect());
  }

  await app.register(errorHandlerPlugin);
  await app.register(cookie);
  await app.register(rateLimitPlugin);
  await app.register(authenticatePlugin, { authService });
  await app.register(csrfPlugin);
  await app.register(authRoutes, { env: options.env, authService });
  await app.register(userRoutes, { userService, approverService, authService });
  await app.register(settingRoutes, { settingService, authService });
  await app.register(logRoutes, { logService, authService });
  await app.register(approvalRoutes, { approvalService, authService });
  await app.register(reminderRoutes, { reminderService, authService });
  await app.register(schedulerPlugin, {
    jobs: reminderJobs,
    enabled: options.env.NODE_ENV === "production"
  });
  await app.register(reportRoutes, {
    reportService,
    rewardService,
    approverService,
    authService
  });
  await app.register(auditRoutes, { auditService });

  app.get("/api/health", async () => ({ status: "ok" as const }));

  await app.ready();
  return app;
}
