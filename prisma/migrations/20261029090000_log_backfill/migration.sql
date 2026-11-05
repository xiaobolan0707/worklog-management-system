-- 幂等：空库创建；已由工作计划版本创建过则跳过
ALTER TABLE "daily_logs"
  ADD COLUMN IF NOT EXISTS "is_backfill" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "backfill_reason" VARCHAR(100);
