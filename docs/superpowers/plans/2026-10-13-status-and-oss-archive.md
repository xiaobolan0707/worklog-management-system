# 全员状态表、工号与 OSS 云端档案库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全员安全查看每日提交/归档状态；管理员维护真实工号；领导在系统中查阅员工提交版及逐级审批版的私有 OSS 历史信纸。只有本轮最终审批版上传成功，归档列才显示“是”。

**Architecture:** 沿用现有用户管理、日志可见范围和信纸组件。提交/审批事务内生成不可变档案快照及待上传记录；后台任务向私有 OSS 上传并记录状态，失败可重试。全员表仅组合用户、当日日志与最终档案上传结果，不读取正文；档案查询逐条复用日志授权。

**Tech Stack:** Node.js 24、TypeScript、Fastify、Prisma/PostgreSQL、React、Vitest、Playwright；阿里云 OSS Node SDK 和 ECS 实例角色凭据。

**Spec:** `docs/工作计划与三星目标评定-计划书.md` 第四、七、九节。**Dependency:** 先执行 `2026-10-13-letter-plan-and-reminders.md`，本计划使用其计划、评星、每轮时间线字段。

## Global Constraints

- 不改现有 `DailyLog.status = ARCHIVED` 的审批含义；全员表“是否归档”另外检查本轮最终审批版 OSS 上传成功，不能只看数据库状态。
- 全员状态接口对普通员工只返回工号、姓名及两个布尔状态；仅有权限的 `LEADER` 可额外取得已正式提交日志的详情标识，正文仍由详情接口二次鉴权。
- 历史档案为独立快照，包含内嵌图片、逐项批注、计划、评星、署名及当时已有时间线；不能从当前日志重新拼装旧版。
- 仅服务端持有 OSS 凭据；私有 Bucket、上海地域内网 endpoint、ECS RAM 实例角色和最小前缀权限；浏览器无 OSS 直连或长期公开 URL。
- 没配置 OSS 或 OSS 故障时日志提交/审批仍可完成，但上传状态不伪造为成功，归档列为“否”。

## Review Focus

- 已有日志的用户可补录工号，旧账号/新注册账号缺工号显示“待补录”；重复工号和越权修改均拒绝。
- 退回重提、多个领导逐级审批、重复任务执行时每个版本只有一个不可变档案，上一轮的上传不能误标本轮归档。
- 数据库提交成功而 OSS 失败时业务记录保留、待传记录可重试；OSS 已写入而数据库回写失败时重试不能覆盖或制造不同内容。
- 普通员工、无关领导直接猜测档案 ID、日志 ID 或切换日期，都不能获得他人正文/图片。
- 不存在日志的员工仍出现在状态表；草稿/退回算未完成，当前轮最终审批档案上传前算未归档。

---

### Task 1: 独立工号及管理员补录

**Files:** Modify `prisma/schema.prisma`, add `prisma/migrations/20261013xxxx_employee_number/migration.sql`, modify `src/modules/users/user.service.ts` (包含 `PrismaAdministrationRepository`), `src/modules/users/user.routes.ts`, `src/web/pages/admin/UsersPage.tsx`, `tests/support/in-memory-administration-repository.ts`; test `tests/unit/users/user.service.test.ts`, `tests/integration/users/admin.routes.test.ts`, `tests/unit/web/leader-admin-pages.test.tsx`, `tests/integration/database/schema.test.ts`.

**Interfaces:** `User.employeeNumber: string | null`，数据库唯一；`AdminUserRecord`/`publicAdminUser` 返回字段；`UserService.setEmployeeNumber(actorId: string, userId: string, employeeNumber: string | null): Promise<AdminUserRecord>`；管理员 `PATCH /api/admin/users/:id/employee-number` 接收 `{ employeeNumber: string | null }`。仅限员工账号录入，空值显示“待补录”。

- [ ] **Step 1: 写失败测试。**`admin_updates_employee_number` 断言成功响应返回所填工号；`duplicate_employee_number_rejected` 断言冲突且原值不变；`non_admin_cannot_update_employee_number` 断言 403；`old_and_registered_employee_have_no_number` 断言 `null` 在页面显示“待补录”；`number_only_for_employee` 断言领导账号不接受录入。
- [ ] **Step 2: 验证先失败。**运行 `pnpm vitest run tests/unit/users/user.service.test.ts tests/integration/users/admin.routes.test.ts tests/unit/web/leader-admin-pages.test.tsx tests/integration/database/schema.test.ts`。
- [ ] **Step 3: 最小实现。**新增可空唯一列；在现有管理员路由内按惯例校验 CSRF/角色并记录审计；用户管理表内加入工号编辑，不改现有注册表单或用户名。
- [ ] **Step 4: 验证通过。**重跑聚焦测试、`pnpm prisma:validate`、`pnpm typecheck`。
- [ ] **Step 5: 提交。**仅暂存本任务文件，提交 `feat: manage distinct employee numbers`。

### Task 2: 事务内档案快照与私有 OSS 上传任务

**Files:** Modify `prisma/schema.prisma`, add `prisma/migrations/20261013xxxx_log_archives/migration.sql`, modify `src/modules/logs/log.repository.ts`, `src/modules/approvals/approval.service.ts` (包含 `PrismaApprovalRepository`), `src/app.ts`, `src/plugins/scheduler.ts`, `src/config/env.ts`, `compose.yaml`, `.env.example`, `package.json`, `pnpm-lock.yaml`; add `src/modules/archives/archive.repository.ts`, `archive.service.ts`, `archive.jobs.ts`, `oss.store.ts`; test `tests/unit/logs/log.repository.test.ts`, `tests/unit/approvals/approval.service.test.ts`, `tests/unit/archives/archive.jobs.test.ts`, `tests/integration/database/schema.test.ts`.

**Interfaces:** `LogArchive` 存日志、提交轮次、`SUBMITTED`/`APPROVED` 阶段、审批级次（提交版为空）、最终审批标记、事件时刻、不可变 JSON 快照、唯一 object key、`PENDING`/`UPLOADED`/`FAILED`、上传时刻与错误摘要。`ArchiveStore.put(key: string, body: Buffer): Promise<void>`、`get(key: string): Promise<Buffer>`，单测用内存 fake；`ArchiveJobs.syncPending(limit = 20): Promise<void>`。对象键包含日志 ID/轮次/阶段/级次及不可变事件 ID，禁止覆盖。

- [ ] **Step 1: 写失败测试。**`submission_creates_snapshot_in_same_transaction` 断言提交成功有一条待传版、事务失败没有孤儿版；`each_approval_creates_distinct_snapshot` 断言每级通过各一版而退回不增加审批版；`archive_snapshot_is_immutable` 断言后续修改不改变旧版图片/批注/计划/评星/时间；`oss_failure_can_retry` 断言失败仍有业务记录与 `FAILED`，恢复后为 `UPLOADED`；`repeat_upload_checks_existing_object` 断言重复任务不增版且已存在对象若内容不同即失败而非覆盖。
- [ ] **Step 2: 验证先失败。**运行 `pnpm vitest run tests/unit/logs/log.repository.test.ts tests/unit/approvals/approval.service.test.ts tests/unit/archives/archive.jobs.test.ts tests/integration/database/schema.test.ts`。
- [ ] **Step 3: 最小实现。**在现有提交/审批事务写档案行；后台每分钟批量处理待传/失败行，同一记录采用原快照与固定 key 重试，OSS 禁止覆盖并核验已存在对象的一致性。配置 Bucket 与上海内网 endpoint；使用 ECS 实例角色取得临时凭据，不提供浏览器直传。未配置 OSS 时记录保持待传并输出可诊断警告，站点其他功能可用。避免把完整图片或凭据写入日志。
- [ ] **Step 4: 验证通过。**重跑聚焦测试、`pnpm prisma:validate`、`pnpm typecheck`、`pnpm build`；用 fake OSS 验证断连和恢复，不以本机网络测试替代生产连通性。
- [ ] **Step 5: 提交。**提交 `feat: queue immutable worklog archives for oss`。

### Task 3: 全员状态只读接口与权限

**Files:** Modify `src/modules/logs/log.repository.ts`, `log.service.ts`, `log.routes.ts`; test `tests/unit/logs/log.repository.test.ts`, `tests/integration/logs/log.routes.test.ts`, `tests/integration/approvals/approval.routes.test.ts`.

**Interfaces:** `LogService.listAllEmployeeStatus(actor: AuthUserRecord, workDate: string): Promise<EmployeeStatusRow[]>`；`GET /api/logs/status?date=YYYY-MM-DD` 默认北京时间今天，返回当前启用且未删除 `EMPLOYEE` 的 `{ employeeNumber, displayName, submitted, archived }`；只有对该员工有授权且该日志已正式提交的 `LEADER` 额外获得 `logId`。`archived` 需要当前轮最终 `APPROVED` 档案 `UPLOADED` 且 `DailyLog.status === ARCHIVED`。

- [ ] **Step 1: 写失败测试。**`status_lists_all_active_employees_even_without_log` 断言无日志行两个 `false`；`employee_status_omits_log_details` 断言响应无 ID/正文/图片/批注；`only_scoped_leader_gets_log_id` 断言授权已提交行有 `logId`，无授权或草稿/退回无 `logId`；`archived_requires_current_final_uploaded` 断言待传/失败/中间版/旧轮成功均 `false`，本轮最终版成功才 `true`；`status_date_uses_beijing_day` 断言午夜边界与指定日期正确。
- [ ] **Step 2: 验证先失败。**运行 `pnpm vitest run tests/unit/logs/log.repository.test.ts tests/integration/logs/log.routes.test.ts tests/integration/approvals/approval.routes.test.ts`。
- [ ] **Step 3: 最小实现。**在全员用户集合上左连接所选日期日志并批量读取对应最终档案状态，避免逐员工查询；复用 `listAuthorizedEmployeeIds` 限定领导链接；详情端继续原有权限检查，并禁止通过表格入口打开草稿/退回正文。
- [ ] **Step 4: 验证通过。**重跑聚焦测试及 `pnpm typecheck`。
- [ ] **Step 5: 提交。**提交 `feat: show all-employee submission and oss archive status`。

### Task 4: 云端档案只读接口、领导入口与全员表页面

**Files:** Add `src/modules/archives/archive.routes.ts`, `src/web/pages/leader/ArchiveLibraryPage.tsx`, `src/web/pages/shared/AllEmployeeStatusPage.tsx`; modify `src/app.ts`, `src/web/router.tsx`, `src/web/components/AppShell.tsx`, `src/web/components/logs/LetterLog.tsx`, `src/web/pages/leader/LogDetailPage.tsx`, `src/web/employee.css`; test `tests/integration/archives/archive.routes.test.ts`, `tests/unit/web/leader-admin-pages.test.tsx`, `tests/unit/web/employee-pages.test.tsx`, `tests/e2e/approval-admin-flow.spec.ts`, `tests/e2e/employee-flow.spec.ts`.

**Interfaces:** `ArchiveService.listVisible(actor: AuthUserRecord, filter: { workDate?: string; employeeQuery?: string }): Promise<ArchiveSummary[]>`；`getVisible(actor: AuthUserRecord, archiveId: string): Promise<ArchiveSnapshot>`。`GET /api/archives` 仅返回授权范围内的档案元数据；`GET /api/archives/:id` 仅对已上传且有日志查看权的 LEADER/MANAGEMENT/ADMIN 返回 OSS 快照。员工角色拒绝。页面复用 `LetterLog` 只读视图呈现历史信纸；全员状态表只有 LEADER 对授权、已正式提交行显示“查看日志”。

- [ ] **Step 1: 写失败测试。**`leader_browses_only_scoped_archives` 断言列表仅授权员工版本；`unuploaded_archive_cannot_open` 断言待传/失败拒绝；`archive_id_guess_is_forbidden` 断言无权领导和员工直接请求拒绝；`archive_detail_uses_stored_snapshot` 断言历史图片、批注、计划、评星和时间线不随当前日志变化；`status_page_switches_date` 断言切换日期/无日志行正确。
- [ ] **Step 2: 验证先失败。**运行 `pnpm vitest run tests/integration/archives/archive.routes.test.ts tests/unit/web/leader-admin-pages.test.tsx tests/unit/web/employee-pages.test.tsx`，再运行相关 Playwright 测试。
- [ ] **Step 3: 最小实现。**服务端列表先按既有日志授权收窄，详情二次鉴权后读取 OSS；响应不含凭据或直链；复用现有信纸组件和应用路由/导航，不新造一个渲染体系。云端库对管理层/管理员按既有完整日志可见范围开放。
- [ ] **Step 4: 验证通过。**重跑聚焦测试、E2E、`pnpm typecheck`、`pnpm build`。
- [ ] **Step 5: 提交。**提交 `feat: browse authorized private oss archives`。

### Task 5: 部署配置、迁移与发布验收

**Files:** Modify `docs/operations/deploy-linux.md`, `docs/operations/release-checklist.md`, `.env.example`, `compose.yaml`; add deployment/migration tests where existing checks apply. Package output under `outputs/` only after validation.

- [ ] **Step 1: 写验收检查。**文档列出上海私有 Bucket、内网 endpoint、ECS RAM 角色绑定、最小前缀权限、连接/拒绝覆盖验证；明确未配置或上传失败时“归档=否”，不把数据库 `ARCHIVED` 当 OSS 成功。
- [ ] **Step 2: 校验环境。**在可用测试数据库上执行迁移检查；运行 `pnpm verify`、相关 Playwright 测试、`pnpm build`；核对打包清单不包含 `.env`、OSS 凭据、数据库 dump。
- [ ] **Step 3: 生成可上传包和 Workbench 部署步骤。**保留备份、迁移、构建、重建容器、健康检查与回滚步骤；不得在没有真实 Bucket 授权时声称 OSS 端到端已通过。
- [ ] **Step 4: 提交。**提交 `docs: document oss archive deployment and verification`，交付包和实际测试结果。

## Handoff

按依赖先执行信纸工作计划实施计划，再执行本计划。完成代码后先在测试环境验证 OSS 角色与私有访问，再由用户按 Workbench 部署步骤上线；若生产 Bucket/实例角色尚未准备，归档列应保持“否”。
