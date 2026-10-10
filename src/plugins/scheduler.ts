import fp from "fastify-plugin";

import type { ReminderJobs } from "../modules/reminders/reminder.jobs.js";

export const schedulerPlugin = fp<{
  jobs: ReminderJobs;
  enabled: boolean;
}>(async (app, options) => {
  if (!options.enabled) return;
  const timer = setInterval(() => {
    void options.jobs.runSubmissionReminderJob(new Date()).catch((error) => app.log.error(error));
  }, 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}, { name: "scheduler" });
