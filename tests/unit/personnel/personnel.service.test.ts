import { describe, expect, it, vi } from "vitest";
import { addCalendarMonths, PersonnelService } from "../../../src/modules/personnel/personnel.service.js";

const hr = { id: "hr", role: "HR" };
const manager = { id: "manager", role: "MANAGEMENT" };
const fixedNow = new Date("2026-11-04T02:00:00Z");
function fixture() {
  const row = {
    id: "u1", username: "someone", displayName: "员工甲", role: "EMPLOYEE", departmentId: "d1",
    department: { name: "研发部" }, employeeNumber: null, numberDepartmentId: null,
    hireDate: null, departureDate: null, employmentStatus: "ACTIVE", createdAt: fixedNow,
    departureMarkedAt: null, loginDisabledAt: null, recycleAt: null, recycledAt: null,
    purgeAt: null, restoredAt: null, archivePurgingAt: null, archivePurgedAt: null
  };
  const delegate = () => ({ findFirst: vi.fn().mockResolvedValue(row), findUnique: vi.fn().mockResolvedValue(row), findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({ count: 1 }), delete: vi.fn(), deleteMany: vi.fn(), create: vi.fn(), upsert: vi.fn() });
  const db = {
    user: delegate(), department: delegate(), approvalStep: delegate(), employeeApprover: delegate(),
    auditEvent: delegate(), session: delegate(), employeeAttachment: delegate(), reminder: delegate(),
    dailyLog: delegate(), colorChange: delegate(), itemCommentReply: delegate(), logVersion: delegate(),
    rewardDecision: delegate(), loginAttempt: delegate(), systemSetting: delegate(),
    $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn(),
    $transaction: vi.fn(async (run) => run(db))
  };
  db.systemSetting.findUnique.mockResolvedValue({ value: "2026-10-01T00:00:00Z" } as never);
  return { db, row, service: new PersonnelService(db as never, { remove: vi.fn() }, () => fixedNow) };
}

describe("personnel lifecycle", () => {
  it("clamps six calendar months in Beijing time without losing the time of day", () => {
    expect(addCalendarMonths(new Date("2026-08-31T15:25:30.123Z"), 6).toISOString())
      .toBe("2027-02-28T15:25:30.123Z");
    expect(addCalendarMonths(new Date("2026-08-31T17:25:00Z"), 6).toISOString())
      .toBe("2027-02-28T17:25:00.000Z");
  });

  it("does not delete database content when a private file cannot be removed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      user: { updateMany, findUnique: vi.fn().mockResolvedValue({ id: "u1", recycledAt: new Date(), archivePurgedAt: null, archivePurgingAt: null }) },
      employeeAttachment: { findMany: vi.fn().mockResolvedValue([{ storageKey: "private-file" }]) },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (run) => run(database))
    };
    const service = new PersonnelService(database as never, { remove: vi.fn().mockRejectedValue(new Error("disk failure")) });
    await expect(service.purge({ id: "manager", role: "MANAGEMENT" }, "u1")).rejects.toThrow("disk failure");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "u1", archivePurgingAt: null, archivePurgedAt: null }),
      data: expect.objectContaining({ archivePurgingAt: expect.any(Date) })
    }));
    expect(database.$transaction).toHaveBeenCalledTimes(1);
    expect(database.$queryRaw.mock.calls[0]?.[0][0]).toContain("pg_advisory_xact_lock");
  });

  it("loses a restore race once purge has claimed the archive", async () => {
    const transaction = {
      user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditEvent: { create: vi.fn() }, $queryRaw: vi.fn().mockResolvedValue([])
    };
    const database = { $transaction: vi.fn(async (run) => run(transaction)) };
    const service = new PersonnelService(database as never, { remove: vi.fn() });
    await expect(service.restore({ id: "manager", role: "MANAGEMENT" }, "u1")).rejects.toMatchObject({ statusCode: 409 });
    expect(transaction.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ archivePurgingAt: null }) }));
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("keeps T0 unchanged for repeated departure edits and refuses reemployment", async () => {
    const { db, row, service } = fixture();
    row.employmentStatus = "DEPARTED";
    await service.update(hr, "u1", { hireDate: "2026-01-01", departureDate: "2026-11-01", employmentStatus: "DEPARTED" });
    expect(db.user.update.mock.calls[0]?.[0].data).not.toHaveProperty("departureMarkedAt");
    expect(db.user.update.mock.calls[0]?.[0].data).not.toHaveProperty("recycleAt");
    await expect(service.update(hr, "u1", { hireDate: null, departureDate: null, employmentStatus: "ACTIVE" })).rejects.toMatchObject({ code: "REEMPLOYMENT_UNSUPPORTED" });
  });

  it("validates impossible dates and date ranges before any mutation", async () => {
    const { service, db } = fixture();
    await expect(service.update(hr, "u1", { hireDate: "2026-02-30", departureDate: null, employmentStatus: "ACTIVE" })).rejects.toMatchObject({ code: "INVALID_DATE" });
    await expect(service.update(hr, "u1", { hireDate: "2026-11-05", departureDate: "2026-11-01", employmentStatus: "DEPARTED" })).rejects.toMatchObject({ code: "INVALID_DATE_RANGE" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("requires a manager for outstanding approvals without returning or approving anything", async () => {
    const { service, db } = fixture();
    db.approvalStep.findMany.mockResolvedValue([{ id: "step", dailyLogId: "other-log", submissionNumber: 1, position: 1 }] as never);
    await expect(service.update(hr, "u1", { hireDate: null, departureDate: "2026-11-04", employmentStatus: "DEPARTED" })).rejects.toMatchObject({ code: "HANDOVER_REQUIRED" });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.approvalStep.updateMany).not.toHaveBeenCalled();
  });

  it("transfers only pending steps and future active assignments, with audit", async () => {
    const { service, db } = fixture();
    db.approvalStep.findMany.mockResolvedValue([{ id: "step", dailyLogId: "other-log", submissionNumber: 1, position: 1 }] as never);
    db.employeeApprover.findMany.mockResolvedValue([{ id: "assignment", employeeId: "other", position: 1 }] as never);
    db.employeeApprover.findUnique.mockResolvedValue(null);
    await service.update(hr, "u1", { hireDate: null, departureDate: "2026-11-04", employmentStatus: "DEPARTED", handoverManagerId: "manager" });
    expect(db.approvalStep.updateMany).toHaveBeenCalledWith({ where: { approverId: "u1", status: "PENDING" }, data: { approverId: "manager" } });
    expect(db.employeeApprover.update).toHaveBeenCalledWith({ where: { id: "assignment" }, data: { approverId: "manager" } });
    expect(db.auditEvent.create.mock.calls.some(([args]) => args.data.action === "APPROVAL_HANDOVER")).toBe(true);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ departureMarkedAt: fixedNow, recycleAt: addCalendarMonths(fixedNow, 6) }) }));
  });

  it("locks the employee before allocating an atomic department number and keeps existing numbers", async () => {
    const { db, service, row } = fixture();
    db.department.update.mockResolvedValue({ nextEmployeeNumber: 1 } as never);
    await service.allocateNumber(hr, "u1");
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.department.update.mock.invocationCallOrder[0]!);
    expect(db.department.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { nextEmployeeNumber: { increment: 1 } }, select: { nextEmployeeNumber: true } });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { employeeNumber: 1, numberDepartmentId: "d1" } });
    row.employeeNumber = 25 as never;
    db.department.update.mockClear();
    await service.allocateNumber(hr, "u1");
    expect(db.department.update).not.toHaveBeenCalled();
  });

  it("restores history disabled and excludes it from subsequent automatic recycling", async () => {
    const { db, service } = fixture();
    await service.restore(manager, "u1");
    expect(db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { deletedAt: null, recycledAt: null, purgeAt: null, restoredAt: fixedNow, accountStatus: "DISABLED", loginDisabledAt: fixedNow } }));
    await service.runJobs(fixedNow, true);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ recycleAt: { lte: fixedNow }, restoredAt: null }) }));
  });

  it("dry runs include the exact day-30 boundary and perform no mutations", async () => {
    const { db, service } = fixture();
    db.user.findMany.mockResolvedValue([{ id: "u1" }] as never);
    const result = await service.runJobs(fixedNow, true);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ departureMarkedAt: { lte: new Date(fixedNow.getTime() - 30 * 86400000) } }) }));
    expect(result).toMatchObject({ disable: ["u1"], recycle: ["u1"], purge: ["u1"], completed: { disabled: 0, recycled: 0, purged: 0 } });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.reminder.upsert).not.toHaveBeenCalled();
  });

  it("purges only owned logs, clears authored content elsewhere and retains anonymized references", async () => {
    const { db, service, row } = fixture();
    row.recycledAt = fixedNow as never;
    await service.purge(manager, "u1");
    expect(db.dailyLog.deleteMany).toHaveBeenCalledWith({ where: { employeeId: "u1" } });
    expect(db.colorChange.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(db.dailyLog.deleteMany.mock.invocationCallOrder[0]!);
    expect(db.approvalStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { approverId: "u1" }, data: expect.objectContaining({ comment: null }) }));
    expect(db.approvalStep.deleteMany).not.toHaveBeenCalled();
    expect(db.user.deleteMany).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ displayName: "已清除员工", employeeNumber: null, archivePurgedAt: fixedNow, accountStatus: "DISABLED" }) }));
  });

  it("does not let HR view the recycle bin or management maintain personnel", async () => {
    const { service, db } = fixture();
    await expect(service.listRecycleBin(hr)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.list(manager)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("keeps processing other employees after one disable or recycle transaction fails", async () => {
    const { service, db } = fixture();
    db.user.findMany.mockResolvedValueOnce([{ id: "first" }, { id: "second" }] as never)
      .mockResolvedValueOnce([{ id: "third" }, { id: "fourth" }] as never).mockResolvedValueOnce([]);
    db.$transaction.mockRejectedValueOnce(new Error("disable failure"))
      .mockImplementationOnce(async (run) => run(db))
      .mockRejectedValueOnce(new Error("recycle failure"));
    const report = await service.runJobs(fixedNow);
    expect(report.completed).toMatchObject({ disabled: 1, recycled: 1 });
    expect(report.errors).toEqual([{ id: "first", message: "disable failure" }, { id: "third", message: "recycle failure" }]);
  });
});
