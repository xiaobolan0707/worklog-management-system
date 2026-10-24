import type { ScheduleSettings } from "../users/user.service.js";
import type { ReminderRepository, ReminderService } from "./reminder.service.js";
import { beijingParts, clockMinutes } from "../../shared/beijing-time.js";

export class ReminderJobs {
  constructor(
    private readonly service: ReminderService,
    private readonly repository: ReminderRepository,
    private readonly getSettings: () => Promise<ScheduleSettings>
  ) {}

  async runSubmissionReminderJob(now: Date) {
    const current = beijingParts(now);
    const settings = await this.getSettings();
    const deadline = clockMinutes(settings.submissionDeadline);
    const warning = deadline - settings.reminderMinutesBefore;
    const missing = await this.repository.listMissingEmployeeIds(current.date);

    if (current.minutes >= deadline) {
      await Promise.all(
        missing.map((recipientId) =>
          this.service.create({
            recipientId,
            kind: "LOG_OVERDUE",
            deduplicationKey: current.date,
            title: "日志已逾期",
            body: "今日工作日志尚未提交。"
          })
        )
      );
    } else if (current.minutes >= warning) {
      await Promise.all(
        missing.map((recipientId) =>
          this.service.create({
            recipientId,
            kind: "LOG_DUE",
            deduplicationKey: current.date,
            title: "日志提交提醒",
            body: "即将到今日工作日志提交截止时间。"
          })
        )
      );
    }

    if (current.minutes >= clockMinutes(settings.approvalDeadline)) {
      const leaders = await this.repository.listOverdueApprovalLeaderIds(current.date);
      await Promise.all(
        leaders.map((recipientId) =>
          this.service.create({
            recipientId,
            kind: "APPROVAL_OVERDUE",
            deduplicationKey: current.date,
            title: "审批逾期提醒",
            body: "您仍有待核查的工作日志。"
          })
        )
      );
    }
  }
}
