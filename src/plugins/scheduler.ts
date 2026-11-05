import fp from "fastify-plugin";

import type { ReminderJobs } from "../modules/reminders/reminder.jobs.js";

export const schedulerPlugin = fp<{
  jobs: ReminderJobs;
  enabled: boolean;
  runPersonnel?: (now: Date) => Promise<void>;
}>(async (app, options) => {
  if (!options.enabled) return;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    const now = new Date();
    void Promise.allSettled([options.jobs.runSubmissionReminderJob(now), options.runPersonnel?.(now)])
      .then((results) => { for (const result of results) if (result.status === "rejected") app.log.error(result.reason); })
      .finally(() => { running = false; });
  }, 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
}, { name: "scheduler" });
