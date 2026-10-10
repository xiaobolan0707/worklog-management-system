import { PrismaPg } from "@prisma/adapter-pg";
import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

import { PrismaClient } from "../generated/prisma/client.js";
import type { AppEnv } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    database: PrismaClient;
  }
}

export interface DatabasePluginOptions {
  env: AppEnv;
}

export function createDatabase(env: AppEnv): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const registerDatabase: FastifyPluginAsync<DatabasePluginOptions> = async (app, options) => {
  const database = createDatabase(options.env);
  app.decorate("database", database);
  app.addHook("onClose", async () => database.$disconnect());
};

export const databasePlugin = fp(registerDatabase, { name: "database" });
