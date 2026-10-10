import Fastify, { type FastifyInstance } from "fastify";

import type { AppEnv } from "./config/env.js";

export interface BuildAppOptions {
  env: AppEnv;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.env.NODE_ENV !== "test" });

  app.get("/api/health", async () => ({ status: "ok" as const }));

  await app.ready();
  return app;
}
