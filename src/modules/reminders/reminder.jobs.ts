import type { ScheduleSettings } from "../users/user.service.js";
import type { ReminderRepository, ReminderService } from "./reminder.service.js";

function beijingParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values["year"]}-${values["month"]}-${values["day"]}`,
    minutes: Number(values["hour"]) * 60 + Number(values["minute"])
  };
}

function clockMinutes(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export class ReminderJobs {
  constructor(
    private readonly service: ReminderService,
    private readonly repository: ReminderRepository,
    private readonly settings: ScheduleSettings
  ) {}

  async runSubmissionReminderJob(now: Date) {
    const current = beijingParts(now);
    const deadline = clockMinutes(this.settings.submissionDeadline);
    const warning = deadline - this.settings.reminderMinutesBefore;
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

    if (current.minutes >= clockMinutes(this.settings.approvalDeadline)) {
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
