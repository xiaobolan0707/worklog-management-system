-- 兼容两种起点：
--   1) 全新数据库：创建 plan_target / plan_due_at
--   2) 已由工作计划版本创建过同名列的生产库：跳过，不报错
ALTER TABLE "daily_logs"
ADD COLUMN IF NOT EXISTS "plan_target" VARCHAR(500),
ADD COLUMN IF NOT EXISTS "plan_due_at" TIMESTAMPTZ(3);
