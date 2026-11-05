-- 幂等：空库创建；已存在则跳过
ALTER TYPE "ReminderKind" ADD VALUE IF NOT EXISTS 'COMMENT_REPLY';

CREATE TABLE IF NOT EXISTS "item_comment_replies" (
    "id" TEXT NOT NULL,
    "approval_step_id" TEXT NOT NULL,
    "item_position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_comment_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "item_comment_replies_approval_step_id_item_position_created_at_idx"
ON "item_comment_replies"("approval_step_id", "item_position", "created_at");

DO $$ BEGIN
  ALTER TABLE "item_comment_replies" ADD CONSTRAINT "item_comment_replies_approval_step_id_fkey"
  FOREIGN KEY ("approval_step_id") REFERENCES "approval_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
