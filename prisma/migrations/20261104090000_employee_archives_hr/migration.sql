-- 本迁移可能叠加在“工作计划版本”已建立部分对象的库上，故全部改为幂等写法。
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR';
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'ARCHIVE_OVERDUE';
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'HR_SUBMISSION';
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'HR_APPROVAL';

DO $$ BEGIN
  CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'DEPARTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ArchiveCategory" AS ENUM ('RESUME', 'DEGREE', 'AGREEMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS employee_number_prefix VARCHAR(20),
  ADD COLUMN IF NOT EXISTS next_employee_number INTEGER NOT NULL DEFAULT 0;

-- 工号兼容：旧版本用 VARCHAR(32) 存自由格式工号，本版本要求 INTEGER 顺序号。
-- 若检测到旧列：摘掉其唯一索引，尝试提取数字后转整数；无法解析的置空，由人事重新分配。
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'employee_number' AND data_type = 'character varying'
  ) THEN
    DROP INDEX IF EXISTS "users_employee_number_key";
    ALTER TABLE "users" ALTER COLUMN "employee_number" TYPE INTEGER
      USING NULLIF(regexp_replace("employee_number", '\D', '', 'g'), '')::integer;
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gender VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS departure_date DATE,
  ADD COLUMN IF NOT EXISTS employment_status "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS departure_marked_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS login_disabled_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS recycle_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS recycled_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS purge_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS archive_purging_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS archive_purged_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS employee_number INTEGER,
  ADD COLUMN IF NOT EXISTS number_department_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_number_department_id_employee_number_key ON users(number_department_id, employee_number);
CREATE INDEX IF NOT EXISTS users_employment_status_recycle_at_recycled_at_idx ON users(employment_status, recycle_at, recycled_at);

CREATE TABLE IF NOT EXISTS employee_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  category "ArchiveCategory" NOT NULL,
  name VARCHAR(200) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size INTEGER NOT NULL,
  storage_key VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS employee_attachments_user_id_category_idx ON employee_attachments(user_id, category);

INSERT INTO system_settings(key,value,updated_at)
VALUES ('employee-archives.enabled-at', to_jsonb(CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- Only the controlled purge transaction may erase private audit payloads.
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.archive_purge', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit events are append-only';
END;
$$ LANGUAGE plpgsql;
