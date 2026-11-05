import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../src/generated/prisma/client.js";
import { HrService } from "../../../src/modules/hr/hr.service.js";
import type { ReminderService } from "../../../src/modules/reminders/reminder.service.js";
import type { AdministrationRepository } from "../../../src/modules/users/user.service.js";
import { createSchemaTestDatabase } from "../../support/schema-test-database.js";

describe("HR exemption setting persistence", () => {
  it("atomically merges only dates, preserving schedule changes made after the initial read", async () => {
    const storage = await createSchemaTestDatabase();
    try {
      await storage.sql`INSERT INTO users (id, username, password_hash, role, updated_at) VALUES ('hr', 'hr', 'hash', 'HR', CURRENT_TIMESTAMP)`;
      const oldSettings = { submissionDeadline: "18:00", reminderMinutesBefore: 30, approvalDeadline: "12:00", timezone: "Asia/Shanghai", logReminderExcludedDates: ["2026-11-01"] };
      const currentSettings = { ...oldSettings, submissionDeadline: "20:00", anotherSetting: true };
      await storage.sql`INSERT INTO system_settings (key, value, updated_at) VALUES ('worklog.schedule', ${JSON.stringify(currentSettings)}::jsonb, CURRENT_TIMESTAMP)`;
      const transaction = { $executeRaw: storage.sql, auditEvent: storage.auditTransaction.auditEvent };
      const database = { $transaction: async (action: (tx: typeof transaction) => Promise<unknown>) => action(transaction) };
      const repository = { getSettings: vi.fn().mockResolvedValue(oldSettings) };
      const service = new HrService(database as unknown as PrismaClient, repository as unknown as AdministrationRepository, {} as ReminderService);
      expect(await service.updateExemptions("hr", { weekdays: [6, 0, 6], dates: ["2026-11-05", "2026-11-05"] })).toEqual({ weekdays: [0, 6], dates: ["2026-11-05"] });
      const saved = await storage.sql<{ value: object }[]>`SELECT value FROM system_settings WHERE key = 'worklog.schedule'`;
      expect(saved[0]?.value).toEqual({ ...currentSettings, logReminderExcludedWeekdays: [0, 6], logReminderExcludedDates: ["2026-11-05"] });
      const audit = await storage.sql<{ actor_id: string; metadata: object }[]>`SELECT actor_id, metadata FROM audit_events WHERE action = 'HR_EXEMPTIONS_CHANGED'`;
      expect(audit).toEqual([{ actor_id: "hr", metadata: { weekdays: [0, 6], dates: ["2026-11-05"] } }]);
    } finally { await storage.close(); }
  });
});
