import { describe, expect, it, vi } from "vitest";

import {
  PrismaAdministrationRepository,
  UserService
} from "../../../src/modules/users/user.service.js";

describe("UserService deletion", () => {
  it("prevents an administrator from deleting their own account", async () => {
    const deleteUser = vi.fn();
    const service = new UserService({ deleteUser } as never);

    await expect(service.deleteUser("admin-1", "admin-1")).rejects.toMatchObject({
      code: "CANNOT_DELETE_SELF"
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("allows deleting an account that has business history", async () => {
    const deleted = { id: "employee-1", username: "employee" };
    const service = new UserService({ deleteUser: async () => deleted } as never);

    await expect(service.deleteUser("admin-1", "employee-1")).resolves.toBe(deleted);
  });

  it("hides and disables a database user while preserving protected business history", async () => {
    const update = vi.fn(async () => ({}));
    const removeAssignments = vi.fn(async () => ({ count: 2 }));
    const revokeSessions = vi.fn(async () => ({ count: 1 }));
    const supersedeApprovals = vi.fn(async () => ({ count: 1 }));
    const returnLogs = vi.fn(async () => ({ count: 1 }));
    const database = {
      $transaction: async (callback: (transaction: unknown) => unknown) => callback({
        user: {
          findFirst: async () => ({
            id: "employee-1",
            username: "employee",
            displayName: "张三",
            passwordHash: "hidden",
            role: "EMPLOYEE",
            accountStatus: "ACTIVE",
            departmentId: null,
            mustChangePassword: false
          }),
          update
        },
        employeeApprover: { deleteMany: removeAssignments },
        session: { updateMany: revokeSessions },
        approvalStep: {
          findMany: async () => [{ dailyLogId: "log-1" }],
          updateMany: supersedeApprovals
        },
        dailyLog: { updateMany: returnLogs },
        auditEvent: { create: async () => ({}) }
      })
    };
    const repository = new PrismaAdministrationRepository(database as never);

    await expect(repository.deleteUser("admin-1", "employee-1")).resolves.toMatchObject({ id: "employee-1" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "employee-1" },
      data: expect.objectContaining({
        accountStatus: "DISABLED",
        username: "deleted-employee-1",
        deletedAt: expect.any(Date)
      })
    }));
    expect(removeAssignments).toHaveBeenCalled();
    expect(revokeSessions).toHaveBeenCalled();
    expect(supersedeApprovals).toHaveBeenCalled();
    expect(returnLogs).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "log-1" }),
      data: expect.objectContaining({ status: "RETURNED" })
    }));
  });
});

describe("PrismaAdministrationRepository registration", () => {
  const input = {
    username: "new.employee",
    displayName: "新员工",
    passwordHash: "hashed-password",
    role: "EMPLOYEE" as const,
    accountStatus: "DISABLED" as const,
    departmentId: null,
    mustChangePassword: false
  };

  it("creates the employee and audit event in one transaction", async () => {
    const user = { id: "employee-2", ...input };
    const createUser = vi.fn(async () => user);
    const createAudit = vi.fn(async () => ({}));
    const transaction = vi.fn(async (callback: (client: unknown) => unknown) => callback({
      user: { create: createUser },
      auditEvent: { create: createAudit }
    }));
    const repository = new PrismaAdministrationRepository({ $transaction: transaction } as never);

    await expect(repository.registerEmployee(input)).resolves.toEqual(user);
    expect(transaction).toHaveBeenCalledOnce();
    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subjectUserId: "employee-2",
        action: "EMPLOYEE_SELF_REGISTERED",
        entityId: "employee-2"
      })
    });
  });

  it("maps a concurrent username conflict to USERNAME_EXISTS", async () => {
    const repository = new PrismaAdministrationRepository({
      $transaction: async () => {
        throw { code: "P2002" };
      }
    } as never);

    await expect(repository.registerEmployee(input)).rejects.toMatchObject({
      statusCode: 409,
      code: "USERNAME_EXISTS"
    });
  });
});
