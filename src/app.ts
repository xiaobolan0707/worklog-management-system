import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppEnv } from "./config/env.js";
import { PrismaAuthRepository, type AuthRepository } from "./modules/auth/auth.repository.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { authenticatePlugin } from "./plugins/authenticate.js";
import { createDatabase } from "./plugins/database.js";
import { rateLimitPlugin } from "./plugins/rate-limit.js";

export interface BuildAppOptions {
  env: AppEnv;
  authRepository?: AuthRepository;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.env.NODE_ENV !== "test" });
  const database = options.authRepository ? null : createDatabase(options.env);
  const authRepository = options.authRepository ?? new PrismaAuthRepository(database!);
  const authService = new AuthService(authRepository);

  if (database) {
    app.addHook("onClose", async () => database.$disconnect());
  }

  await app.register(cookie);
  await app.register(rateLimitPlugin);
  await app.register(authenticatePlugin, { authService });
  await app.register(authRoutes, { env: options.env, authService });

  app.get("/api/health", async () => ({ status: "ok" as const }));

  await app.ready();
  return app;
}
