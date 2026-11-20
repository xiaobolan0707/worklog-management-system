-- 每日工作计划与评星（最小闭环：员工填目标 -> 审批人评 MET / DELAYED / UNMET）
-- 与日志红灰定色完全独立，不改动任何现有表。

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PlanRating" AS ENUM ('MET', 'DELAYED', 'UNMET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WorkPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "work_plans" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "target" VARCHAR(500) NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "status" "WorkPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "rating" "PlanRating",
    "rated_by_id" TEXT,
    "rated_at" TIMESTAMPTZ(3),
    "note" VARCHAR(500),
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_plans_pkey" PRIMARY KEY ("id")
);

-- 兼容已有更早版本的 work_plans：CREATE TABLE IF NOT EXISTS 会整体跳过，
-- 这里逐列补齐，避免后面的外键引用不存在的列（现网实测缺 rated_by_id）。
-- 注意：可能已存在的列不加 NOT NULL，防止现有行触发约束失败。
ALTER TABLE "work_plans"
    ADD COLUMN IF NOT EXISTS "employee_id" TEXT,
    ADD COLUMN IF NOT EXISTS "work_date" DATE,
    ADD COLUMN IF NOT EXISTS "target" VARCHAR(500),
    ADD COLUMN IF NOT EXISTS "due_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "status" "WorkPlanStatus" DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS "rating" "PlanRating",
    ADD COLUMN IF NOT EXISTS "rated_by_id" TEXT,
    ADD COLUMN IF NOT EXISTS "rated_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "note" VARCHAR(500),
    ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(3),
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
-- 旧表可能已有重复的 (employee_id, work_date)，唯一索引建不上就跳过，不让迁移失败。
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "work_plans_employee_id_work_date_key" ON "work_plans"("employee_id", "work_date");
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "work_plans_status_work_date_idx" ON "work_plans"("status", "work_date");

-- AddForeignKey
-- 旧数据可能存在指向已删除用户的孤立行；约束加不上时跳过，保证迁移可完成。
DO $$ BEGIN
  ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_rated_by_id_fkey" FOREIGN KEY ("rated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN foreign_key_violation THEN NULL;
END $$;
