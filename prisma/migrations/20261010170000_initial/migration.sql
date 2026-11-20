-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'LEADER', 'MANAGEMENT', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LogStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'RETURNED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WorkColor" AS ENUM ('GREEN', 'RED', 'GRAY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED', 'SUPERSEDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReminderKind" AS ENUM ('LOG_DUE', 'LOG_OVERDUE', 'APPROVAL_ASSIGNED', 'APPROVAL_OVERDUE', 'LOG_RETURNED', 'APPROVAL_COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RewardPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RewardOutcome" AS ENUM ('REWARD', 'IMPROVEMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LoginOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'LOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "departments" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100),
    "role" "Role" NOT NULL,
    "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "department_id" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "employee_approvers" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "daily_logs" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "status" "LogStatus" NOT NULL DEFAULT 'DRAFT',
    "color" "WorkColor",
    "submission_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "log_items" (
    "id" TEXT NOT NULL,
    "daily_log_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "unfinished_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "log_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "log_versions" (
    "id" TEXT NOT NULL,
    "daily_log_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "approval_steps" (
    "id" TEXT NOT NULL,
    "daily_log_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "color" "WorkColor",
    "comment" TEXT,
    "acted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "color_changes" (
    "id" TEXT NOT NULL,
    "daily_log_id" TEXT NOT NULL,
    "changed_by_id" TEXT NOT NULL,
    "from_color" "WorkColor" NOT NULL,
    "to_color" "WorkColor" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "color_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reminders" (
    "id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "deduplication_key" VARCHAR(191) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "related_log_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reward_decisions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "department_id" TEXT,
    "decided_by_id" TEXT NOT NULL,
    "period_type" "RewardPeriod" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "red_count" INTEGER NOT NULL,
    "gray_count" INTEGER NOT NULL,
    "outcome" "RewardOutcome" NOT NULL,
    "note" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "csrf_secret" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "login_attempts" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "user_id" TEXT,
    "ip_address" VARCHAR(64),
    "outcome" "LoginOutcome" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_events" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "subject_user_id" TEXT,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(191) NOT NULL,
    "metadata" JSONB NOT NULL,
    "ip_address" VARCHAR(64),
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "system_settings" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_department_id_idx" ON "users"("department_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "employee_approvers_approver_id_idx" ON "employee_approvers"("approver_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "employee_approvers_employee_id_position_key" ON "employee_approvers"("employee_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "employee_approvers_employee_id_approver_id_key" ON "employee_approvers"("employee_id", "approver_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "daily_logs_work_date_status_idx" ON "daily_logs"("work_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "daily_logs_employee_id_work_date_key" ON "daily_logs"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "log_items_daily_log_id_position_key" ON "log_items"("daily_log_id", "position");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "log_versions_created_by_id_idx" ON "log_versions"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "log_versions_daily_log_id_version_number_key" ON "log_versions"("daily_log_id", "version_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "approval_steps_approver_id_status_idx" ON "approval_steps"("approver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "approval_steps_daily_log_id_position_key" ON "approval_steps"("daily_log_id", "position");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "color_changes_daily_log_id_created_at_idx" ON "color_changes"("daily_log_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reminders_recipient_id_read_at_created_at_idx" ON "reminders"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reminders_recipient_id_kind_deduplication_key_key" ON "reminders"("recipient_id", "kind", "deduplication_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reward_decisions_department_id_period_start_period_end_idx" ON "reward_decisions"("department_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reward_decisions_employee_id_period_type_period_start_perio_key" ON "reward_decisions"("employee_id", "period_type", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_attempts_username_created_at_idx" ON "login_attempts"("username", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_events_subject_user_id_created_at_idx" ON "audit_events"("subject_user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "employee_approvers" ADD CONSTRAINT "employee_approvers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "employee_approvers" ADD CONSTRAINT "employee_approvers_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "log_items" ADD CONSTRAINT "log_items_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "log_versions" ADD CONSTRAINT "log_versions_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "log_versions" ADD CONSTRAINT "log_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "color_changes" ADD CONSTRAINT "color_changes_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "color_changes" ADD CONSTRAINT "color_changes_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reminders" ADD CONSTRAINT "reminders_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reminders" ADD CONSTRAINT "reminders_related_log_id_fkey" FOREIGN KEY ("related_log_id") REFERENCES "daily_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reward_decisions" ADD CONSTRAINT "reward_decisions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reward_decisions" ADD CONSTRAINT "reward_decisions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reward_decisions" ADD CONSTRAINT "reward_decisions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Audit records are immutable at the database boundary.
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON "audit_events";

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
