ALTER TABLE "daily_logs"
ADD COLUMN "plan_target" VARCHAR(500),
ADD COLUMN "plan_due_at" TIMESTAMPTZ(3);
