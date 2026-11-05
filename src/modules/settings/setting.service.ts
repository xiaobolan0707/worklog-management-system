import { z } from "zod";

import type { AdministrationRepository, ScheduleSettings } from "../users/user.service.js";

export const scheduleSettingsSchema = z.object({
  submissionDeadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reminderMinutesBefore: z.number().int().min(0).max(1440),
  approvalDeadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.literal("Asia/Shanghai"),
  logReminderExcludedWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  logReminderExcludedDates: z.array(z.iso.date()).optional()
});

export class SettingService {
  constructor(private readonly repository: AdministrationRepository) {}

  async get() {
    const settings = await this.repository.getSettings();
    return {
      ...settings,
      logReminderExcludedWeekdays: settings.logReminderExcludedWeekdays ?? [],
      logReminderExcludedDates: settings.logReminderExcludedDates ?? []
    };
  }

  async update(actorId: string, input: unknown): Promise<ScheduleSettings> {
    const parsed = scheduleSettingsSchema.parse(input);
    const current = await this.get();
    const settings = {
      ...parsed,
      logReminderExcludedWeekdays: parsed.logReminderExcludedWeekdays ?? current.logReminderExcludedWeekdays,
      logReminderExcludedDates: parsed.logReminderExcludedDates ?? current.logReminderExcludedDates
    };
    const saved = await this.repository.saveSettings(settings, {
      submissionDeadline: parsed.submissionDeadline, approvalDeadline: parsed.approvalDeadline,
      reminderMinutesBefore: parsed.reminderMinutesBefore, timezone: parsed.timezone,
      ...(parsed.logReminderExcludedWeekdays !== undefined ? { logReminderExcludedWeekdays: parsed.logReminderExcludedWeekdays } : {}),
      ...(parsed.logReminderExcludedDates !== undefined ? { logReminderExcludedDates: parsed.logReminderExcludedDates } : {})
    });
    await this.repository.appendAudit({
      actorId,
      action: "SETTINGS_CHANGED",
      entityType: "SystemSetting",
      entityId: "worklog.schedule",
      metadata: settings
    });
    return saved;
  }
}
