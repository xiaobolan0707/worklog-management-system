import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AuditService } from "./audit.service.js";

const querySchema = z.object({
  actorId: z.string().max(191).optional(),
  subjectUserId: z.string().max(191).optional(),
  action: z.string().max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const auditRoutes: FastifyPluginAsync<{ auditService: AuditService }> = async (
  app,
  options
) => {
  app.get(
    "/api/audit-events",
    { preHandler: app.requireRole("MANAGEMENT", "ADMIN") },
    async (request) => options.auditService.search(querySchema.parse(request.query))
  );
};
