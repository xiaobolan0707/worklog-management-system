import type {
  ReminderInput,
  ReminderRecord,
  ReminderRepository
} from "../../src/modules/reminders/reminder.service.js";

export class InMemoryReminderRepository implements ReminderRepository {
  readonly reminders: ReminderRecord[] = [];
  activeEmployeeIds: string[] = [];
  missingEmployeeIds: string[] = [];
  overdueApprovalLeaderIds: string[] = [];

  async createDeduplicated(input: ReminderInput) {
    const existing = this.reminders.find(
      (item) =>
        item.recipientId === input.recipientId &&
        item.kind === input.kind &&
        item.deduplicationKey === input.deduplicationKey
    );
    if (existing) return existing;
    const reminder: ReminderRecord = {
      id: `reminder-${this.reminders.length + 1}`,
      ...input,
      readAt: null,
      createdAt: new Date("2026-10-10T00:00:00.000Z")
    };
    this.reminders.push(reminder);
    return reminder;
  }

  async listForRecipient(recipientId: string) {
    return this.reminders.filter((item) => item.recipientId === recipientId);
  }

  async markRead(recipientId: string, reminderId: string, readAt: Date) {
    const reminder = this.reminders.find(
      (item) => item.id === reminderId && item.recipientId === recipientId
    );
    if (!reminder) return null;
    reminder.readAt = readAt;
    return reminder;
  }

  async listMissingEmployeeIds() {
    return this.missingEmployeeIds;
  }

  async listOverdueApprovalLeaderIds() {
    return this.overdueApprovalLeaderIds;
  }
}
