import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PrismaClient } from "./generated/prisma/client.js";
import { ArchiveStorage } from "./modules/archives/archive-storage.js";
import { ArchiveService } from "./modules/archives/archive.service.js";
import { archiveRoutes } from "./modules/archives/archive.routes.js";
import { HrService } from "./modules/hr/hr.service.js";
import { hrRoutes } from "./modules/hr/hr.routes.js";
import { PersonnelService } from "./modules/personnel/personnel.service.js";
import { personnelRoutes } from "./modules/personnel/personnel.routes.js";
import { PlanService } from "./modules/plans/plan.service.js";
import { planRoutes } from "./modules/plans/plan.routes.js";
import { statusRoutes } from "./modules/status/status.routes.js";

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
  database?: PrismaClient;
  webRoot?: string | undefined;
  archiveStorage?: ArchiveStorage;
  env: AppEnv;
  now?: () => Date;
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
  const app = Fastify({
    logger: options.env.NODE_ENV !== "test",
    trustProxy: ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  });
  const database = options.database ?? (options.authRepository && options.administrationRepository && options.logRepository && options.approvalRepository && options.reminderRepository && options.reportRepository && options.rewardRepository && options.auditQueryRepository
    ? null
    : createDatabase(options.env));
  const authRepository = options.authRepository ?? new PrismaAuthRepository(database!);
  const administrationRepository = options.administrationRepository
    ?? new PrismaAdministrationRepository(database!);
  const logRepository = options.logRepository ?? new PrismaLogRepository(database!);
  const approvalRepository = options.approvalRepository ?? new PrismaApprovalRepository(database!);
  const reminderRepository = options.reminderRepository ?? new PrismaReminderRepository(database!);
  const reportRepository = options.reportRepository ?? new PrismaReportRepository(database!, () => settingService.get());
  const rewardRepository = options.rewardRepository ?? new PrismaRewardRepository(database!);
  const auditQueryRepository = options.auditQueryRepository ?? new PrismaAuditQueryRepository(database!);
  const authService = new AuthService(authRepository, options.now, options.env.SESSION_SECRET);
  const userService = new UserService(administrationRepository);
  const approverService = new ApproverService(administrationRepository);
  const planService = new PlanService(database!, approverService, options.now);
  const settingService = new SettingService(administrationRepository);
  const logService = new LogService(logRepository, approverService, options.now);
  const approvalService = new ApprovalService(approvalRepository);
  const reminderService = new ReminderService(reminderRepository);
  const reportService = new ReportService(reportRepository);
  const rewardService = new RewardService(rewardRepository, reportService);
  const auditService = new AuditService(auditQueryRepository);
  const reminderJobs = new ReminderJobs(reminderService, reminderRepository, () => settingService.get());
  const storage = options.archiveStorage ?? new ArchiveStorage(options.env.ARCHIVE_STORAGE_DIR ?? resolve("data/employee-archives"));
  const archiveService = new ArchiveService(database!, storage, options.now);
  const hrService = new HrService(database!, administrationRepository, reminderService, options.now);
  const personnelService = new PersonnelService(database!, storage, options.now);

  if (database && !options.database) {
    app.addHook("onClose", async () => database.$disconnect());
  }

  // SEC-11：统一安全响应头，覆盖 API 与静态资源，避免仅依赖网关配置。
  app.addHook("onSend", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Content-Security-Policy", [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'"
    ].join("; "));
    if (options.env.NODE_ENV === "production" && options.env.COOKIE_SECURE) {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  // SEC-01：生产环境拒绝经明文 HTTP 接入的请求（由反向代理透传协议）。
  if (options.env.NODE_ENV === "production" && options.env.REQUIRE_HTTPS) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/api/health") return;
      const forwarded = request.headers["x-forwarded-proto"];
      const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
      const protocol = value?.split(",")[0]?.trim().toLowerCase();
      if (protocol === "http") {
        request.log.warn({ ip: request.ip, url: request.url }, "rejected plain-HTTP request");
        return reply.code(403).send({ code: "HTTPS_REQUIRED", message: "请通过 HTTPS 访问系统" });
      }
    });
  }

  await app.register(errorHandlerPlugin);
  await app.register(cookie);
  await app.register(rateLimitPlugin);
  await app.register(authenticatePlugin, { authService });
  await app.register(csrfPlugin);
  await app.register(authRoutes, { env: options.env, authService, userService });
  await app.register(userRoutes, { userService, approverService, authService });
  await app.register(archiveRoutes, { archiveService, authService });
  await app.register(hrRoutes, { hrService, authService });
  await app.register(personnelRoutes, { personnelService, authService });
  await app.register(planRoutes, { planService, authService });
  await app.register(statusRoutes, { database: database!, settings: settingService, now: options.now });
  await app.register(settingRoutes, { settingService, authService });
  await app.register(logRoutes, { logService, authService });
  await app.register(approvalRoutes, { approvalService, authService });
  await app.register(reminderRoutes, { reminderService, authService });
  // SEC-05：安全日志保留期清理，每 6 小时执行一次，避免无限增长拖慢审计查询。
  let lastSecurityMaintenance = 0;
  await app.register(schedulerPlugin, {
    jobs: reminderJobs,
    runSecurityMaintenance: async (now) => {
      if (!database || now.getTime() - lastSecurityMaintenance < 6 * 3_600_000) return;
      lastSecurityMaintenance = now.getTime();
      const cutoff = new Date(now.getTime() - options.env.SECURITY_LOG_RETENTION_DAYS * 86_400_000);
      const removed = await database.loginAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (removed.count > 0) {
        app.log.info({ removed: removed.count, cutoff }, "expired login attempts purged");
      }
    },
    runPersonnel: async (now) => {
      const report = await personnelService.runJobs(now, !options.env.ARCHIVE_LIFECYCLE_ENABLED);
      for (const error of report.errors) app.log.error(error);
      if (options.env.ARCHIVE_LIFECYCLE_ENABLED) {
        const files = await database!.employeeAttachment.findMany({ select: { storageKey: true } });
        await storage.sweepUnreferenced(new Set(files.map((file) => file.storageKey)));
      }
    },
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

  if (options.env.NODE_ENV === "production") {
    await app.register(staticFiles, {
      root: options.webRoot ?? fileURLToPath(new URL("../web", import.meta.url)),
      wildcard: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "接口不存在" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.ready();
  return app;
}
