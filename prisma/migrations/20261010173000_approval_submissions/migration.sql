ALTER TABLE "approval_steps"
ADD COLUMN "submission_number" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "approval_steps_daily_log_id_position_key";

CREATE UNIQUE INDEX "approval_steps_daily_log_id_submission_number_position_key"
ON "approval_steps"("daily_log_id", "submission_number", "position");
