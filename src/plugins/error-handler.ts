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
    // 解析失败（如畸形 JSON）由 Fastify 标记为 4xx，这里统一按客户端错误返回，
    // 避免落入 500 分支污染错误日志、误导调用方重试。
    const clientStatus = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0;
    if (clientStatus >= 400 && clientStatus < 500) {
      return reply.code(clientStatus).send({
        code: clientStatus === 400 ? "BAD_REQUEST" : "REQUEST_REJECTED",
        message: clientStatus === 400 ? "请求内容无效，请检查提交数据" : "请求被拒绝",
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
