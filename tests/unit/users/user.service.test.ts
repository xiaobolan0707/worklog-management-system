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

  it("requires disabling an account that already has business history", async () => {
    const service = new UserService({ deleteUser: async () => "HAS_HISTORY" } as never);

    await expect(service.deleteUser("admin-1", "employee-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "USER_HAS_HISTORY"
    });
  });

  it("does not delete a database user with protected business history", async () => {
    const remove = vi.fn();
    const database = {
      $transaction: async (callback: (transaction: unknown) => unknown) => callback({
        user: {
          findUnique: async () => ({
            id: "employee-1",
            username: "employee",
            displayName: "张三",
            passwordHash: "hidden",
            role: "EMPLOYEE",
            accountStatus: "ACTIVE",
            departmentId: null,
            mustChangePassword: false,
            _count: {
              dailyLogs: 1,
              logVersions: 0,
              approvalSteps: 0,
              colorChanges: 0,
              rewardSubjects: 0,
              rewardDecisions: 0
            }
          }),
          delete: remove
        }
      })
    };
    const repository = new PrismaAdministrationRepository(database as never);

    await expect(repository.deleteUser("admin-1", "employee-1")).resolves.toBe("HAS_HISTORY");
    expect(remove).not.toHaveBeenCalled();
  });
});
