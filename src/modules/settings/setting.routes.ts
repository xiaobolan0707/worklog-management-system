import type { FastifyPluginAsync } from "fastify";

import type { AuthService } from "../auth/auth.service.js";
import { sendAdministrationError } from "../users/user.routes.js";
import type { SettingService } from "./setting.service.js";

export interface SettingRoutesOptions {
  settingService: SettingService;
  authService: AuthService;
}

export const settingRoutes: FastifyPluginAsync<SettingRoutesOptions> = async (app, options) => {
  const adminOnly = app.requireRole("ADMIN");

  app.get("/api/admin/settings", { preHandler: adminOnly }, async () => ({
    settings: await options.settingService.get()
  }));

  app.put("/api/admin/settings", { preHandler: adminOnly }, async (request, reply) => {
    try {
      options.authService.verifyCsrf(
        request.authenticated!,
        request.headers["x-csrf-token"] as string | undefined
      );
      const settings = await options.settingService.update(
        request.authenticated!.user.id,
        request.body
      );
      return { settings };
    } catch (error) {
      return sendAdministrationError(reply, error);
    }
  });
};
