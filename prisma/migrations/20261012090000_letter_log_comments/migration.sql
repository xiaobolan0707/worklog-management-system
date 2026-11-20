ALTER TABLE "log_items" ADD COLUMN IF NOT EXISTS "images" JSONB;
ALTER TABLE "approval_steps" ADD COLUMN IF NOT EXISTS "item_comments" JSONB;
