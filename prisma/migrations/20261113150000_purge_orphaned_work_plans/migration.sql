-- 清理已永久清除档案的员工所遗留的工作计划记录。
-- 幂等 + 防御：仅在 work_plans 及相关列都存在时执行，避免在旧库上因列缺失而失败。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'work_plans' AND column_name = 'note'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'archive_purged_at'
  ) THEN
    DELETE FROM work_plans AS plan USING users AS employee
    WHERE plan.employee_id = employee.id AND employee.archive_purged_at IS NOT NULL;

    UPDATE work_plans AS plan SET rated_by_id = NULL, note = NULL FROM users AS rater
    WHERE plan.rated_by_id = rater.id AND rater.archive_purged_at IS NOT NULL;
  END IF;
END $$;
