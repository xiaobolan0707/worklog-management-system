import { z } from "zod";

import type { AdministrationRepository, ScheduleSettings } from "../users/user.service.js";

export const scheduleSettingsSchema = z.object({
  submissionDeadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reminderMinutesBefore: z.number().int().min(0).max(1440),
  approvalDeadline: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.literal("Asia/Shanghai")
});

export class SettingService {
  constructor(private readonly repository: AdministrationRepository) {}

  get() {
    return this.repository.getSettings();
  }

  async update(actorId: string, input: unknown): Promise<ScheduleSettings> {
    const settings = scheduleSettingsSchema.parse(input);
    const saved = await this.repository.saveSettings(settings);
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
