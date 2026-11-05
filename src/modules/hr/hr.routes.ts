import type { FastifyPluginAsync } from "fastify";

import type { AuthService } from "../auth/auth.service.js";
import { sendAdministrationError } from "../users/user.routes.js";
import { hrStatusCsv, type HrService } from "./hr.service.js";

export interface HrRoutesOptions { hrService: HrService; authService: AuthService }

export const hrRoutes: FastifyPluginAsync<HrRoutesOptions> = async (app, options) => {
  const hrOnly = app.requireRole("HR");
  app.get("/api/hr/status", { preHandler: hrOnly }, async (request, reply) => {
    try { return await options.hrService.status(request.query); }
    catch (error) { return sendAdministrationError(reply, error); }
  });
  app.get("/api/hr/status/export", { preHandler: hrOnly }, async (request, reply) => {
    try {
      const result = await options.hrService.status(request.query);
      return reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="hr-status-${result.from}-${result.to}.csv"`).send(hrStatusCsv(result));
    } catch (error) { return sendAdministrationError(reply, error); }
  });
  app.post("/api/hr/reminders", { preHandler: hrOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string | undefined);
      return await options.hrService.remind(request.authenticated!.user.id, request.body);
    } catch (error) { return sendAdministrationError(reply, error); }
  });
  app.get("/api/hr/exemptions", { preHandler: hrOnly }, async (_request, reply) => {
    try { return await options.hrService.exemptions(); }
    catch (error) { return sendAdministrationError(reply, error); }
  });
  app.put("/api/hr/exemptions", { preHandler: hrOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(request.authenticated!, request.headers["x-csrf-token"] as string | undefined);
      return await options.hrService.updateExemptions(request.authenticated!.user.id, request.body);
    } catch (error) { return sendAdministrationError(reply, error); }
  });
};
