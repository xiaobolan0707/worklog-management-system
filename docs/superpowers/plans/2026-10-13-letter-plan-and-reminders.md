# 信纸工作计划、评星、时间线与提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 员工为每份日志提交一条带选定完成时间的工作计划，审批人逐级评星，双方查看准确时间线，并在计划到期前收到站内提醒。

**Architecture:** 沿用 `DailyLog`、`LogVersion`、`ApprovalStep` 和现有信纸组件；计划与评星使用独立字段，不复用日志颜色。提醒复用现有定时任务与去重表，运行时读取当前系统设置。

**Tech Stack:** Node.js 24、TypeScript、Fastify、Prisma/PostgreSQL、React、Vitest、Playwright。

**Spec:** `docs/工作计划与三星目标评定-计划书.md` 第一至三、五、六节。

## Global Constraints

- 每日日志只填一条计划；草稿可不完整，正式提交必须有未来的北京时间、非空且最多 500 字的目标。
- 现有每份日志至少四项、每项至少 20 个非空白字符、图片和逐项批注规则不变；历史无计划日志继续可读可审。
- `PlanRating` 为 `MET`、`DELAYED`、`UNMET`，分别显示红、绿、灰；现有 `DailyLog.color` 不变。
- 提交/审批/退回时间由服务端产生，页面按 `Asia/Shanghai` 显示至秒；退回重提保留各轮记录。
- 计划提醒沿用系统的 `reminderMinutesBefore`，默认 30 分钟；仅员工本人和审批链中的 `LEADER` 接收，按轮次去重。

## Review Focus

- 旧日志计划字段为空：仍可审批和查看，不能因新字段必填而报错；Task 1、2 测试。
- 两次提交之间计划改期：旧轮快照/时间保留，提醒重新计算且不重复；Task 1、4 测试。
- 计划时间在提交瞬间已过：服务端拒绝，不能只靠浏览器校验；Task 1 测试。
- 非当前审批人提交评星或员工自行改评星：拒绝且不写时间/结果；Task 2 测试。
- 设置页面改提前量后定时任务不重启：下一轮检查使用新值；Task 4 测试。

---

### Task 1: 工作计划与每轮提交快照

**Files:** Modify `prisma/schema.prisma`, add `prisma/migrations/20261013xxxx_work_plan/migration.sql`, modify `src/modules/logs/log.schemas.ts`, `src/modules/logs/log.repository.ts`, `src/modules/logs/log.service.ts`, `tests/support/in-memory-log-repository.ts`; test `tests/unit/logs/log.validation.test.ts`, `tests/unit/logs/log.repository.test.ts`, `tests/integration/database/schema.test.ts`。

**Interfaces:** 扩展 `LogDraftInput`、`DailyLogRecord` 和 `logDraftSchema`：`planTarget?: string | null`、`planDueAt?: string | null`（API 使用 ISO 时间）；浏览器的 `YYYY-MM-DDTHH:mm` 按北京时间转 ISO 后再发送。`DailyLogRecord.submittedAt: string | null`，`versions` 中每轮含 `submissionNumber: number`、`submittedAt: string | null` 和计划快照。`submitOwnedLog(logId: string, employeeId: string): Promise<SubmitLogResult>` 现有签名不变。

- [ ] **Step 1: 写失败测试。**`draft_allows_incomplete_plan` 断言缺计划可保存；`submit_requires_future_plan` 断言缺目标、缺时间、时间已过各返回 400；`plan_target_max_500` 断言第 501 字被拒；`resubmission_keeps_plan_versions` 断言两轮快照目标/时间不相同且各有真实 `submittedAt`；`legacy_log_without_plan_loads` 断言旧记录读取成功。
- [ ] **Step 2: 验证测试先失败。**运行 `pnpm vitest run tests/unit/logs/log.validation.test.ts tests/unit/logs/log.repository.test.ts tests/integration/database/schema.test.ts`，预期新断言失败。
- [ ] **Step 3: 最小实现。**迁移新增 `DailyLog.planTarget/planDueAt` 与 `LogVersion.submissionNumber/submittedAt/planTarget/planDueAt`；在 `submitOwnedLog` 的同一事务、同一个服务端时刻写主记录与快照。`LogService.submitLog` 针对计划无效给出明确错误，不把计划校验混入“每项 20 字”提示。
- [ ] **Step 4: 验证通过。**重跑聚焦测试及 `pnpm prisma:validate`、`pnpm typecheck`。
- [ ] **Step 5: 提交。**仅暂存本任务文件，提交 `feat: save one work plan per log submission`。

### Task 2: 每级评星与秒级时间线

**Files:** Modify `prisma/schema.prisma` 和本阶段迁移、`src/modules/approvals/approval.schemas.ts`, `src/modules/approvals/approval.routes.ts`, `src/modules/approvals/approval.service.ts`, `src/modules/logs/log.repository.ts`, `src/web/components/logs/ApprovalProgress.tsx`, `tests/support/in-memory-approval-repository.ts`; test `tests/unit/approvals/approval.service.test.ts`, `tests/integration/approvals/approval.routes.test.ts`, `tests/unit/web/leader-admin-pages.test.tsx`。

**Interfaces:** `ApprovalStep.planRating: "MET" | "DELAYED" | "UNMET" | null`；`approvalDecisionSchema` 增加可选 `planRating`，`approveCurrentStep(logId, leaderId, color, itemComments, planRating?)` 对有计划的日志要求有值；`returnCurrentStep` 签名不变。日志读取返回 `submissionNumber`、`actedAt`、`planRating`，前端按轮次展示员工提交/审批/退回事件。

- [ ] **Step 1: 写失败测试。**`planned_approval_requires_one_star` 断言无星返回 400，三个枚举值各自可保存且互斥；`legacy_approval_does_not_require_star` 断言旧日志可审批；`approval_timeline_is_per_step` 断言每级与退回各有不同 `actedAt`；`not_current_approver_cannot_rate` 断言 403 且无写入；`resubmit_preserves_previous_round_events` 断言旧轮仍可查。
- [ ] **Step 2: 验证测试先失败。**运行 `pnpm vitest run tests/unit/approvals/approval.service.test.ts tests/integration/approvals/approval.routes.test.ts tests/unit/web/leader-admin-pages.test.tsx`。
- [ ] **Step 3: 最小实现。**新增独立 `PlanRating` 枚举/字段；在现有审批事务中校验和写入评星，只生成一次操作时刻；复用 `ApprovalProgress`，以北京时间 `YYYY-MM-DD HH:mm:ss` 显示全部轮次和动作，空值显示“待审批”或“历史记录未保存时间”。
- [ ] **Step 4: 验证通过。**重跑聚焦测试、`pnpm typecheck`。
- [ ] **Step 5: 提交。**提交 `feat: record plan ratings and approval timeline`。

### Task 3: 员工与审批人信纸界面

**Files:** Modify `src/web/components/logs/LetterLog.tsx`, `WorkItemEditor.tsx`, `src/web/pages/employee/TodayLogPage.tsx`, `HistoryPage.tsx`, `src/web/pages/leader/ApprovalPage.tsx`, `LogDetailPage.tsx`, `src/web/employee.css`; test `tests/unit/web/employee-pages.test.tsx`, `tests/unit/web/leader-admin-pages.test.tsx`, `tests/e2e/employee-flow.spec.ts`, `tests/e2e/approval-admin-flow.spec.ts`。

**Interfaces:** `LetterLog` 增加 `planTarget?: string | null`、`planDueAt?: string | null`、`planRating?: "MET" | "DELAYED" | "UNMET" | null` 与 `timeline?: TimelineEvent[]`（`submissionNumber`, `actorName`, `action`, `actedAt`）；员工草稿表单提供日期/时间选择与目标输入，领导审批表单提供三选一星级。`storageKey(userId: string, workDate: string): string`，避免共用浏览器切换账号泄露草稿。

- [ ] **Step 1: 写失败测试。**`employee_edits_plan_and_submits` 断言日期/目标随草稿保存、缺项出现字段错误、提交后只读；`leader_reviews_full_letter` 断言完整四项及计划可见、初始三颗星无色、确认审批无星被阻止、退回无星可提交；`timeline_displays_beijing_seconds` 断言每轮/每级按 `YYYY-MM-DD HH:mm:ss` 显示；`employee_sees_new_review_within_five_seconds` 用假时钟断言页面打开状态下审批结果 5 秒内刷新；`letter_footer_survives_print_and_narrow_width` 断言页脚内容存在且打印样式未隐藏。
- [ ] **Step 2: 验证测试先失败。**运行 `pnpm vitest run tests/unit/web/employee-pages.test.tsx tests/unit/web/leader-admin-pages.test.tsx`。
- [ ] **Step 3: 最小实现。**延伸现有 `LetterLog` 布局与 CSS；不新建第二套信纸；让今日、历史、审批和详情共用展示；审批人返回时不强制选星。员工历史/详情页可见时每 5 秒重新拉取当前日志，卸载时清理定时器。
- [ ] **Step 4: 验证通过。**运行聚焦单测、`pnpm typecheck`、相关 Playwright 用例（若浏览器可用）。
- [ ] **Step 5: 提交。**提交 `feat: show work plan and stars on letter logs`。

### Task 4: 工作计划到期前双向提醒

**Files:** Modify `prisma/schema.prisma` 和本阶段迁移、`src/modules/reminders/reminder.jobs.ts`, `src/modules/reminders/reminder.service.ts`, `src/app.ts`, `src/plugins/scheduler.ts`, `tests/support/in-memory-reminder-repository.ts`; test `tests/integration/reminders/reminder.jobs.test.ts`, `tests/unit/reminders/reminder.service.test.ts`。

**Interfaces:** 增加提醒类型 `PLAN_DUE`；`ReminderRepository.listUpcomingPlans(now: Date, warningEnd: Date): Promise<PlanReminderCandidate[]>`，其中 candidate 为 `{ logId, submissionNumber, employeeId, employeeName, planTarget, planDueAt, leaderIds }`，仅包含当前轮与授权 `LEADER`；`ReminderJobs.runPlanDueReminderJob(now: Date): Promise<void>` 每轮通过注入的 `SettingService.get()` 读取设置，不沿用 `app.ts` 目前启动时缓存的副本。去重键包含日志 ID、提交轮次与计划时间。

- [ ] **Step 1: 写失败测试。**`plan_due_notifies_employee_and_assigned_leaders` 断言员工及每位对应领导各一条、无关领导零条；`plan_due_skips_ineligible_logs` 断言草稿/退回/已评定/过期零条；`plan_due_is_idempotent_per_submission` 断言重复调度仍各一条而改期重提新增一条；`plan_due_uses_updated_setting` 断言把提前量从 30 改成 60 后无需重启即可进入提醒窗口。
- [ ] **Step 2: 验证测试先失败。**运行 `pnpm vitest run tests/integration/reminders/reminder.jobs.test.ts tests/unit/reminders/reminder.service.test.ts`。
- [ ] **Step 3: 最小实现。**复用 `ReminderService.create`、一分钟调度和唯一键；提醒仅含授权接收人的目标摘要与日期，沿用现有站内提醒菜单。
- [ ] **Step 4: 验证通过。**重跑聚焦测试、全量 `pnpm test`、`pnpm typecheck`、`pnpm build`。
- [ ] **Step 5: 提交。**提交 `feat: remind employees and leaders before plan due time`。

## Execution Handoff

完成本计划并验收后，执行 `2026-10-13-status-and-oss-archive.md`；不要在第一阶段先把审批流程状态当作 OSS 上传成功。
