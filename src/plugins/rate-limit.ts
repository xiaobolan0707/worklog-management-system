import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";

export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: "1 minute"
  });
}, { name: "login-rate-limit" });
