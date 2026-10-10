import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppEnv } from "./config/env.js";
import { PrismaAuthRepository, type AuthRepository } from "./modules/auth/auth.repository.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
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
import { createDatabase } from "./plugins/database.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";

export interface BuildAppOptions {
  env: AppEnv;
  authRepository?: AuthRepository;
  administrationRepository?: AdministrationRepository;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.env.NODE_ENV !== "test" });
  const database = options.authRepository && options.administrationRepository
    ? null
    : createDatabase(options.env);
  const authRepository = options.authRepository ?? new PrismaAuthRepository(database!);
  const administrationRepository = options.administrationRepository
    ?? new PrismaAdministrationRepository(database!);
  const authService = new AuthService(authRepository);
  const userService = new UserService(administrationRepository);
  const approverService = new ApproverService(administrationRepository);
  const settingService = new SettingService(administrationRepository);

  if (database) {
    app.addHook("onClose", async () => database.$disconnect());
  }

  await app.register(cookie);
  await app.register(rateLimitPlugin);
  await app.register(authenticatePlugin, { authService });
  await app.register(authRoutes, { env: options.env, authService });
  await app.register(userRoutes, { userService, approverService, authService });
  await app.register(settingRoutes, { settingService, authService });

  app.get("/api/health", async () => ({ status: "ok" as const }));

  await app.ready();
  return app;
}
