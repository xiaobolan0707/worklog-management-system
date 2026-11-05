import Fastify, { type FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthError, type AuthService } from "../../../src/modules/auth/auth.service.js";
import { hrRoutes } from "../../../src/modules/hr/hr.routes.js";
import type { HrService } from "../../../src/modules/hr/hr.service.js";

describe("dedicated HR routes", () => {
  it("enforces HR-only access and CSRF on both writes", async () => {
    const app = Fastify();
    const service = { status: vi.fn().mockResolvedValue({ from: "2026-11-02", to: "2026-11-04", rows: [], summary: {}, employees: [], departments: [] }), exemptions: vi.fn().mockResolvedValue({ weekdays: [], dates: [] }), updateExemptions: vi.fn().mockResolvedValue({ weekdays: [], dates: [] }), remind: vi.fn().mockResolvedValue({ sent: true }) };
    app.decorate("requireRole", (...roles: string[]) => async (request: FastifyRequest, reply) => {
      const role = String(request.headers["x-role"] ?? "");
      if (!roles.includes(role)) return reply.code(403).send({ code: "FORBIDDEN" });
      request.authenticated = { user: { id: "hr", role } } as unknown as FastifyRequest["authenticated"];
    });
    const auth = { verifyCsrf: (_session: unknown, token: string | undefined) => {
      if (token !== "valid") throw new AuthError(403, "INVALID_CSRF", "CSRF token invalid");
    } };
    await app.register(hrRoutes, { hrService: service as unknown as HrService, authService: auth as unknown as AuthService });
    try {
      for (const role of ["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN", ""]) {
        for (const url of ["/api/hr/status", "/api/hr/status/export", "/api/hr/exemptions"]) {
          expect((await app.inject({ method: "GET", url, headers: { "x-role": role } })).statusCode).toBe(403);
        }
      }
      expect(service.status).not.toHaveBeenCalled();
      for (const [method, url] of [["POST", "/api/hr/reminders"], ["PUT", "/api/hr/exemptions"]] as const) {
        expect((await app.inject({ method, url, headers: { "x-role": "HR" }, payload: {} })).statusCode).toBe(403);
        expect((await app.inject({ method, url, headers: { "x-role": "HR", "x-csrf-token": "valid" }, payload: {} })).statusCode).toBe(200);
      }
      const exported = await app.inject({ url: "/api/hr/status/export?from=2026-11-02&to=2026-11-04", headers: { "x-role": "HR" } });
      expect(exported.statusCode).toBe(200);
      expect(exported.headers["content-type"]).toContain("text/csv");
      expect(service.status).toHaveBeenLastCalledWith({ from: "2026-11-02", to: "2026-11-04" });
      expect(exported.body).toContain("审批状态");
    } finally { await app.close(); }
  });
});
