import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import type { AuthService } from "../auth/auth.service.js";
import { AuthError } from "../auth/auth.service.js";
import type { ApproverService } from "./approver.service.js";
import {
  AdministrationError,
  publicAdminUser,
  type UserService
} from "./user.service.js";

const idParams = z.object({ id: z.string().min(1).max(191) });
const userSchema = z.object({
  username: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(1).max(100).optional(),
  initialPassword: z.string().min(12).max(256),
  role: z.enum(["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN"]),
  departmentId: z.string().min(1).max(191).nullable().optional()
});
const departmentSchema = z.object({ name: z.string().trim().min(1).max(100) });
const statusSchema = z.object({ accountStatus: z.enum(["ACTIVE", "DISABLED"]) });
const resetSchema = z.object({ initialPassword: z.string().min(12).max(256) });
const approverSchema = z.object({ approverIds: z.array(z.string().min(1).max(191)).max(10) });

export interface UserRoutesOptions {
  userService: UserService;
  approverService: ApproverService;
  authService: AuthService;
}

function verifyCsrf(request: FastifyRequest, authService: AuthService) {
  authService.verifyCsrf(
    request.authenticated!,
    request.headers["x-csrf-token"] as string | undefined
  );
}

export function sendAdministrationError(reply: FastifyReply, error: unknown) {
  if (error instanceof AdministrationError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: "请检查输入内容" });
  }
  throw error;
}

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (app, options) => {
  const adminOnly = app.requireRole("ADMIN");

  app.post("/api/admin/users", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const input = userSchema.parse(request.body);
      const user = await options.userService.createUser(request.authenticated!.user.id, input);
      return reply.code(201).send({ user: publicAdminUser(user) });
    } catch (error) {
      return sendAdministrationError(reply, error);
    }
  });

  app.post("/api/admin/departments", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { name } = departmentSchema.parse(request.body);
      const department = await options.userService.createDepartment(
        request.authenticated!.user.id,
        name
      );
      return reply.code(201).send({ department });
    } catch (error) {
      return sendAdministrationError(reply, error);
    }
  });

  app.patch("/api/admin/users/:id/status", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      const { accountStatus } = statusSchema.parse(request.body);
      const user = await options.userService.setStatus(
        request.authenticated!.user.id,
        id,
        accountStatus
      );
      return { user: publicAdminUser(user) };
    } catch (error) {
      return sendAdministrationError(reply, error);
    }
  });

  app.post("/api/admin/users/:id/reset-password", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      const { initialPassword } = resetSchema.parse(request.body);
      const user = await options.userService.resetPassword(
        request.authenticated!.user.id,
        id,
        initialPassword
      );
      return { user: publicAdminUser(user) };
    } catch (error) {
      return sendAdministrationError(reply, error);
    }
  });

  app.put("/api/admin/users/:id/approvers", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      const { approverIds } = approverSchema.parse(request.body);
      const assignments = await options.approverService.replace(id, approverIds);
      return { assignments };
    } catch (error) {
      return sendAdministrationError(reply, error);
    }
  });
};
