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
  initialPassword: z.string().min(1).max(256),
  role: z.enum(["EMPLOYEE", "LEADER", "MANAGEMENT", "ADMIN", "HR"]),
  departmentId: z.string().min(1).max(191).nullable().optional()
});
const departmentSchema = z.object({ name: z.string().trim().min(1).max(100) });
const departmentParams = z.object({ id: z.string().min(1).max(191), employeeId: z.string().min(1).max(191).optional() });
const employeeCreateSchema = userSchema.pick({ username: true, initialPassword: true }).extend({ displayName: z.string().trim().min(1).max(100) }).strict();
const employeeUpdateSchema = employeeCreateSchema.omit({ initialPassword: true }).extend({ departmentId: z.string().min(1).max(191) }).strict();
const employeeDepartmentSchema = z.object({ departmentId: z.string().min(1).max(191) }).strict();
const statusSchema = z.object({ accountStatus: z.enum(["ACTIVE", "DISABLED"]) });
const resetSchema = z.object({ initialPassword: z.string().min(1).max(256) });
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

export function sendAdministrationError(reply: FastifyReply, error: unknown, validationMessage = "请检查输入内容") {
  if (error && typeof error === "object" && "code" in error && error.code === "P2025") return reply.code(404).send({ code: "NOT_FOUND", message: "对象不存在或已移入回收站，请刷新后重试" });
  if (error instanceof AdministrationError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ code: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ code: "VALIDATION_ERROR", message: validationMessage });
  }
  throw error;
}

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (app, options) => {
  const adminOnly = app.requireRole("ADMIN");
  const departmentManagers = app.requireRole("ADMIN", "MANAGEMENT", "LEADER");
  // 人事可查看全部部门并把员工调整到目标部门，但不能新建员工或重置口令。
  const departmentViewers = app.requireRole("ADMIN", "MANAGEMENT", "LEADER", "HR");
  const employeeOnly = app.requireRole("EMPLOYEE");

  app.get("/api/departments", { preHandler: departmentViewers }, async (request, reply) => {
    try { return { departments: await options.userService.listManagedDepartments(request.authenticated!.user) }; }
    catch (error) { return sendAdministrationError(reply, error); }
  });

  app.get("/api/departments/:id/employees", { preHandler: departmentViewers }, async (request, reply) => {
    try {
      const { id } = departmentParams.parse(request.params);
      return { employees: (await options.userService.listDepartmentEmployees(request.authenticated!.user, id)).map(publicAdminUser) };
    } catch (error) { return sendAdministrationError(reply, error); }
  });

  app.post("/api/departments/:id/employees", { preHandler: departmentManagers }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = departmentParams.parse(request.params);
      const input = employeeCreateSchema.parse(request.body);
      const user = await options.userService.createDepartmentEmployee(request.authenticated!.user, id, input);
      return reply.code(201).send({ user: publicAdminUser(user) });
    } catch (error) { return sendAdministrationError(reply, error, "请填写有效的用户名、员工姓名和至少 6 位的初始密码"); }
  });

  app.patch("/api/departments/:id/employees/:employeeId", { preHandler: departmentViewers }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id, employeeId } = departmentParams.extend({ employeeId: z.string().min(1).max(191) }).parse(request.params);
      const input = employeeUpdateSchema.parse(request.body);
      const user = await options.userService.updateDepartmentEmployee(request.authenticated!.user, id, employeeId, input);
      return { user: publicAdminUser(user) };
    } catch (error) { return sendAdministrationError(reply, error, "请填写有效的员工姓名、用户名和所属部门；不能修改角色等权限字段"); }
  });

  // 移出部门：只解除部门归属，工号（employee_number / number_department_id）保留，三个月内不释放。
  app.delete("/api/departments/:id/employees/:employeeId", { preHandler: departmentViewers }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id, employeeId } = departmentParams.extend({ employeeId: z.string().min(1).max(191) }).parse(request.params);
      const result = await options.userService.removeDepartmentEmployee(request.authenticated!.user, id, employeeId);
      return { user: publicAdminUser(result.user), employeeNumberLabel: result.employeeNumberLabel, numberRetainedUntil: result.numberRetainedUntil };
    } catch (error) { return sendAdministrationError(reply, error, "移出部门失败，请稍后重试"); }
  });

  app.patch("/api/admin/departments/:id", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      const { name } = departmentSchema.strict().parse(request.body);
      return { department: await options.userService.renameDepartment(request.authenticated!.user.id, id, name) };
    } catch (error) { return sendAdministrationError(reply, error, "部门名称不能为空，且不能超过 100 个字符"); }
  });

  app.get("/api/profile", { preHandler: app.requireRole("EMPLOYEE", "LEADER", "MANAGEMENT") }, async (request, reply) => {
    try { return { user: publicAdminUser(await options.userService.getEmployeeProfile(request.authenticated!.user.id)) }; }
    catch (error) { return sendAdministrationError(reply, error); }
  });

  app.get("/api/profile/departments", { preHandler: employeeOnly }, async () => ({ departments: await options.userService.listDepartments() }));

  app.put("/api/profile/department", { preHandler: employeeOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { departmentId } = employeeDepartmentSchema.parse(request.body);
      return { user: publicAdminUser(await options.userService.setOwnDepartment(request.authenticated!.user.id, departmentId)) };
    } catch (error) { return sendAdministrationError(reply, error, "请选择有效的所属部门，仅允许修改本人的部门归属"); }
  });

  app.get("/api/departments/employees", { preHandler: departmentViewers }, async (request, reply) => {
    try { return { employees: await options.userService.listAssignableEmployees(request.authenticated!.user) }; }
    catch (error) { return sendAdministrationError(reply, error, "员工列表加载失败，请重试"); }
  });

  app.post("/api/departments/:id/assign", { preHandler: departmentViewers }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      const { employeeId } = z.object({ employeeId: z.string().min(1) }).strict().parse(request.body);
      return { user: await options.userService.assignEmployee(request.authenticated!.user, id, employeeId) };
    } catch (error) { return sendAdministrationError(reply, error, "调入失败，请重试"); }
  });

  app.get("/api/admin/users", { preHandler: adminOnly }, async () => ({
    users: (await options.userService.listUsers()).map(publicAdminUser)
  }));

  app.patch("/api/admin/departments/:id/number-prefix", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      const { prefix } = z.object({ prefix: z.string().trim().max(20).regex(/^[\p{L}\p{N}_\- ]*$/u).nullable() }).strict().parse(request.body);
      return { department: await options.userService.setNumberPrefix(request.authenticated!.user.id, id, prefix) };
    } catch (error) { return sendAdministrationError(reply, error, "工号标识最多 20 个汉字、字母、数字、下划线、短横线或空格"); }
  });

  app.get("/api/admin/departments", { preHandler: adminOnly }, async () => ({
    departments: await options.userService.listDepartments()
  }));

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

  app.delete("/api/admin/users/:id", { preHandler: adminOnly }, async (request, reply) => {
    try {
      verifyCsrf(request, options.authService);
      const { id } = idParams.parse(request.params);
      await options.userService.deleteUser(request.authenticated!.user.id, id);
      return reply.code(204).send();
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

  app.get("/api/admin/users/:id/approvers", { preHandler: adminOnly }, async (request, reply) => {
    try {
      const { id } = idParams.parse(request.params);
      return { assignments: await options.approverService.listApprovers(id) };
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
