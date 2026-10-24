import { afterEach, describe, expect, it } from "vitest";

import { appendAudit } from "../../../src/modules/audit/audit.repository.js";
import { createSchemaTestDatabase } from "../../support/schema-test-database.js";

const databases: Awaited<ReturnType<typeof createSchemaTestDatabase>>[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

async function setup() {
  const database = await createSchemaTestDatabase();
  databases.push(database);
  await database.sql`
    INSERT INTO departments (id, name, updated_at)
    VALUES ('department-1', '研发部', CURRENT_TIMESTAMP)
  `;
  await database.sql`
    INSERT INTO users (id, username, password_hash, role, department_id, updated_at)
    VALUES
      ('employee-1', 'employee', 'hash', 'EMPLOYEE', 'department-1', CURRENT_TIMESTAMP),
      ('leader-1', 'leader', 'hash', 'LEADER', 'department-1', CURRENT_TIMESTAMP)
  `;
  return database;
}

describe("production database schema", () => {
  it("rejects an approver relationship that references a missing leader", async () => {
    const database = await setup();

    await expect(
      database.sql`
        INSERT INTO employee_approvers (id, employee_id, approver_id, position, updated_at)
        VALUES ('assignment-1', 'employee-1', 'missing-leader', 1, CURRENT_TIMESTAMP)
      `
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it("allows only one daily log for each employee and work date", async () => {
    const database = await setup();
    await database.sql`
      INSERT INTO daily_logs (id, employee_id, work_date, status, updated_at)
      VALUES ('log-1', 'employee-1', '2026-10-10', 'DRAFT', CURRENT_TIMESTAMP)
    `;

    await expect(
      database.sql`
        INSERT INTO daily_logs (id, employee_id, work_date, status, updated_at)
        VALUES ('log-2', 'employee-1', '2026-10-10', 'DRAFT', CURRENT_TIMESTAMP)
      `
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("stores a work plan deadline with the production migration", async () => {
    const database = await setup();
    await database.sql`
      INSERT INTO daily_logs (id, employee_id, work_date, status, plan_target, plan_due_at, updated_at)
      VALUES ('log-plan', 'employee-1', '2026-10-16', 'DRAFT', '完成周报', '2026-10-16T18:00:00+08:00', CURRENT_TIMESTAMP)
    `;

    const rows = await database.sql<{ plan_target: string; plan_due_at: Date }[]>`
      SELECT plan_target, plan_due_at FROM daily_logs WHERE id = 'log-plan'
    `;
    expect(rows[0]?.plan_target).toBe("完成周报");
    expect(new Date(rows[0]!.plan_due_at).toISOString()).toBe("2026-10-16T10:00:00.000Z");
  });

  it("keeps approver positions and approvers unique for each employee", async () => {
    const database = await setup();
    await database.sql`
      INSERT INTO employee_approvers (id, employee_id, approver_id, position, updated_at)
      VALUES ('assignment-1', 'employee-1', 'leader-1', 1, CURRENT_TIMESTAMP)
    `;

    await expect(
      database.sql`
        INSERT INTO employee_approvers (id, employee_id, approver_id, position, updated_at)
        VALUES ('assignment-2', 'employee-1', 'leader-1', 2, CURRENT_TIMESTAMP)
      `
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("deduplicates reminders for the same recipient, kind, and event key", async () => {
    const database = await setup();
    await database.sql`
      INSERT INTO reminders (id, recipient_id, kind, deduplication_key, title, body)
      VALUES ('reminder-1', 'employee-1', 'LOG_DUE', '2026-10-10', '提醒', '请提交日志')
    `;

    await expect(
      database.sql`
        INSERT INTO reminders (id, recipient_id, kind, deduplication_key, title, body)
        VALUES ('reminder-2', 'employee-1', 'LOG_DUE', '2026-10-10', '提醒', '请提交日志')
      `
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("stores a comment reply and its leader reminder with the production migration", async () => {
    const database = await setup();
    await database.sql`
      INSERT INTO daily_logs (id, employee_id, work_date, updated_at)
      VALUES ('log-reply', 'employee-1', '2026-10-22', CURRENT_TIMESTAMP)
    `;
    await database.sql`
      INSERT INTO approval_steps (id, daily_log_id, approver_id, position, updated_at)
      VALUES ('step-reply', 'log-reply', 'leader-1', 1, CURRENT_TIMESTAMP)
    `;
    await database.sql`
      INSERT INTO item_comment_replies (id, approval_step_id, item_position, content)
      VALUES ('reply-1', 'step-reply', 1, '测试通过')
    `;
    await database.sql`
      INSERT INTO reminders (id, recipient_id, kind, deduplication_key, title, body, related_log_id)
      VALUES ('reply-reminder', 'leader-1', 'COMMENT_REPLY', 'reply-1', '员工回复', '请查收', 'log-reply')
    `;
    const replies = await database.sql<{ content: string }[]>`
      SELECT content FROM item_comment_replies WHERE approval_step_id = 'step-reply'
    `;
    expect(replies).toEqual([{ content: "测试通过" }]);
    const reminders = await database.sql<{ kind: string }[]>`
      SELECT kind FROM reminders WHERE id = 'reply-reminder'
    `;
    expect(reminders).toEqual([{ kind: "COMMENT_REPLY" }]);
  });

  it("appends audit events and prevents later mutation", async () => {
    const database = await setup();
    const created = await appendAudit(database.auditTransaction, {
      actorId: "leader-1",
      subjectUserId: "employee-1",
      action: "LOG_SUBMITTED",
      entityType: "DailyLog",
      entityId: "log-1",
      metadata: { workDate: "2026-10-10" }
    });

    expect(created.action).toBe("LOG_SUBMITTED");
    const rows = await database.sql<{ action: string }[]>`
      SELECT action FROM audit_events WHERE id = ${created.id}
    `;
    expect(rows).toEqual([{ action: "LOG_SUBMITTED" }]);

    await expect(
      database.sql`UPDATE audit_events SET action = 'CHANGED' WHERE id = ${created.id}`
    ).rejects.toThrow(/append-only/i);
    await expect(
      database.sql`DELETE FROM audit_events WHERE id = ${created.id}`
    ).rejects.toThrow(/append-only/i);
  });
});
