import fp from "fastify-plugin";

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) {
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后重试",
        requestId: request.id
      });
    }
    const validation = typeof error === "object" && error !== null && "validation" in error;
    if (validation) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "请求参数无效",
        requestId: request.id
      });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "服务器内部错误",
      requestId: request.id
    });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== "string") return payload;
    const contentType = String(reply.getHeader("content-type") ?? "");
    if (!contentType.includes("application/json")) return payload;
    try {
      const body = JSON.parse(payload) as Record<string, unknown>;
      if (body["requestId"]) return payload;
      return JSON.stringify({ ...body, requestId: request.id });
    } catch {
      return payload;
    }
  });
}, { name: "error-handler" });
