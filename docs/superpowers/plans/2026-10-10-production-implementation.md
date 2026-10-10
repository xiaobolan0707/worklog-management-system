# 员工工作日志管理系统正式版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Linux 云服务器上交付一套供 50 人以内使用、具备真实账号、PostgreSQL 持久化、多级红灰审批、系统内提醒、周期统计和审计追踪的正式员工工作日志系统。

**Architecture:** 使用一个 TypeScript/Fastify 进程提供 REST API 并托管 React/Vite 构建产物，PostgreSQL 通过 Prisma 持久化，Nginx 作为公网入口。应用、数据库、反向代理和备份任务由 Docker Compose 管理；现有静态演示版只作为交互和视觉参考，不直接升级为生产存储。

**Tech Stack:** Node.js 24 LTS、TypeScript 5.9+、Fastify 5、Prisma ORM 7、PostgreSQL 16、React 19、Vite、Vitest、Playwright、Docker Compose、Nginx。

**Spec:** `docs/superpowers/specs/2026-10-10-production-design.md`

## Global Constraints

- 部署目标为 Linux 云服务器，当前公网 IP 为 `101.132.147.80`。
- 首期用户规模为 50 人以内。
- 账号由管理员创建，初始密码首次登录必须修改。
- 第一阶段只使用系统内提醒，不接入短信、邮件、企业微信或钉钉。
- 员工每天最多一篇正式日志，工作事项按 1、2、3 排列。
- 绿色表示已提交待核查；红色表示完成；灰色表示未完成或逾期。
- 整个系统不得出现数字评分字段、接口或界面。
- 支持顺序多级审批、退回重交和有原因的红灰改色。
- 数据库不得暴露公网端口，密码不得明文保存。
- PostgreSQL 每日备份并保留最近 30 天。
- 所有关键状态变更必须写入不可覆盖的审计记录。
- 生产依赖安装时使用锁文件锁定当时通过测试的具体版本。

## Review Focus

- 同一员工同一天重复创建或并发提交日志时，必须由数据库唯一约束拒绝且不得产生重复审计记录；Task 5 添加并发集成测试。
- 领导构造其他部门或非授权员工的日志 ID 时，接口必须返回 403 且不泄露日志内容；Task 6 添加越权测试。
- 多级审批的两个请求并发到达时，只能有当前审批人成功一次；Task 6 添加事务与幂等测试。
- 定时任务重复运行或服务重启时，同一员工同一提醒类型同一天只能生成一条提醒；Task 7 添加去重测试。
- 备份文件损坏、数据库不可用或恢复失败时，部署脚本必须非零退出并留下清晰日志；Task 13 添加失败路径测试。

---

## File Structure

正式版根目录使用以下结构：

- `package.json`、`package-lock.json`：统一依赖和脚本。
- `prisma/schema.prisma`、`prisma/migrations/`：数据库模型和版本化迁移。
- `src/server.ts`、`src/app.ts`：进程入口和 Fastify 组合根。
- `src/config/`：环境变量、日志和安全配置。
- `src/plugins/`：数据库、会话、鉴权、错误处理和任务调度插件。
- `src/modules/auth/`：登录、首次改密、退出和登录限制。
- `src/modules/users/`：用户、部门、角色和审批关系管理。
- `src/modules/logs/`：每日工作日志、事项、退回重交和版本记录。
- `src/modules/approvals/`：顺序审批、红灰定色、改色和审批进度。
- `src/modules/reminders/`：系统内提醒、已读状态和定时生成。
- `src/modules/reports/`：周期统计和奖惩确认。
- `src/modules/audit/`：统一审计写入与查询。
- `src/web/`：React 页面、组件、路由、API 客户端和样式。
- `tests/unit/`、`tests/integration/`、`tests/e2e/`：分层测试。
- `infra/nginx/`、`infra/scripts/`、`Dockerfile`、`compose.yaml`：部署、备份和恢复。
- `.env.example`：不含秘密的配置模板。

### Task 1: 项目骨架、配置与健康检查

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`
- Create: `src/config/env.ts`, `src/app.ts`, `src/server.ts`
- Create: `src/web/index.html`, `src/web/main.tsx`, `src/web/App.tsx`
- Test: `tests/unit/config/env.test.ts`, `tests/integration/health.test.ts`

**Interfaces:**
- Produces: `loadEnv(input?: NodeJS.ProcessEnv): AppEnv`; `buildApp(options: BuildAppOptions): Promise<FastifyInstance>`; `GET /api/health -> { status: "ok" }`.

- [ ] **Step 1: Write failing configuration and health tests** — assert missing `DATABASE_URL` and `SESSION_SECRET` fail startup, valid configuration parses, and `/api/health` returns 200 with `{status:"ok"}`.
- [ ] **Step 2: Run `npm test -- tests/unit/config/env.test.ts tests/integration/health.test.ts`** — expected FAIL because modules and route do not exist.
- [ ] **Step 3: Scaffold the Node 24 TypeScript/Fastify application and minimal React/Vite entry** — implement only the interfaces above; initialize Git in the formal-version directory and add `.gitignore`.
- [ ] **Step 4: Run the focused tests and `npm run typecheck`** — expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "chore: scaffold production worklog app"`.

### Task 2: PostgreSQL 模型与数据库基础设施

**Files:**
- Create: `prisma/schema.prisma`, `prisma/migrations/*/migration.sql`, `prisma/seed.ts`
- Create: `src/plugins/database.ts`, `src/modules/audit/audit.repository.ts`
- Test: `tests/integration/database/schema.test.ts`

**Interfaces:**
- Consumes: `AppEnv` from Task 1.
- Produces: `DatabasePlugin`; Prisma models `User`, `Department`, `EmployeeApprover`, `DailyLog`, `LogItem`, `LogVersion`, `ApprovalStep`, `ColorChange`, `Reminder`, `RewardDecision`, `Session`, `LoginAttempt`, `AuditEvent`, `SystemSetting`.
- Produces: `appendAudit(tx, event: AuditInput): Promise<AuditEvent>`.

- [ ] **Step 1: Write failing schema integration tests** — assert foreign keys, employee/date uniqueness, ordered approver uniqueness, reminder deduplication key and audit append behavior.
- [ ] **Step 2: Run `npm test -- tests/integration/database/schema.test.ts`** — expected FAIL because schema and migration are absent.
- [ ] **Step 3: Define Prisma models, first migration, database plugin and deterministic seed** — seed one admin only; do not seed demo employees in production mode.
- [ ] **Step 4: Run migration against the test database, focused tests and `npm run prisma:validate`** — expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: add production database schema"`.

### Task 3: 登录、会话与首次修改密码

**Files:**
- Create: `src/modules/auth/auth.service.ts`, `auth.routes.ts`, `password.ts`, `session.ts`
- Create: `src/plugins/authenticate.ts`, `src/plugins/rate-limit.ts`
- Test: `tests/unit/auth/password.test.ts`, `tests/integration/auth/auth.routes.test.ts`

**Interfaces:**
- Consumes: Prisma `User`, `Session`, `LoginAttempt`; `appendAudit`.
- Produces: `POST /api/auth/login`, `POST /api/auth/change-initial-password`, `POST /api/auth/logout`, `GET /api/auth/me`.
- Produces: `requireUser`, `requireRole(...roles)` Fastify guards.

- [ ] **Step 1: Write failing auth tests** — cover password hashing, wrong password, disabled account, first-login gate, session expiry, logout invalidation and temporary lock after configured failures.
- [ ] **Step 2: Run auth tests** — expected FAIL because endpoints and guards are absent.
- [ ] **Step 3: Implement password hashing, server-side sessions in secure HttpOnly cookies, login rate limiting and audit events** — cookie `Secure` is environment-controlled until HTTPS is enabled; `SameSite=Lax` and CSRF protection remain mandatory.
- [ ] **Step 4: Run focused tests, typecheck and dependency audit** — expected PASS with no high-severity production dependency finding.
- [ ] **Step 5: Commit** — `git commit -m "feat: add secure account authentication"`.

### Task 4: 用户、部门和审批关系管理

**Files:**
- Create: `src/modules/users/user.service.ts`, `user.routes.ts`, `department.service.ts`, `approver.service.ts`
- Create: `src/modules/settings/setting.service.ts`, `setting.routes.ts`
- Test: `tests/integration/users/admin.routes.test.ts`, `tests/unit/users/approver.service.test.ts`

**Interfaces:**
- Consumes: `requireRole('ADMIN')`; Prisma user and department models; `appendAudit`.
- Produces: admin CRUD endpoints for users and departments; `PUT /api/admin/users/:id/approvers`; `POST /api/admin/users/:id/reset-password`; `GET /api/admin/settings`; `PUT /api/admin/settings`.
- Produces: `listAuthorizedEmployeeIds(actorId: string): Promise<string[]>`.

- [ ] **Step 1: Write failing admin tests** — assert only admins create/disable/reset accounts, usernames are unique, initial-password flag is set, approver order is stable, deadline/reminder settings are validated, and unrelated leaders cannot administer users.
- [ ] **Step 2: Run focused tests** — expected FAIL because admin services are absent.
- [ ] **Step 3: Implement transactional admin operations and audit events** — disabling a user preserves history; resetting a password revokes existing sessions.
- [ ] **Step 4: Run focused tests and all auth tests** — expected PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: add organization and approver administration"`.

### Task 5: 每日工作日志与版本记录

**Files:**
- Create: `src/modules/logs/log.service.ts`, `log.repository.ts`, `log.routes.ts`, `log.schemas.ts`
- Test: `tests/unit/logs/log.validation.test.ts`, `tests/integration/logs/log.routes.test.ts`, `tests/integration/logs/log.concurrent.test.ts`

**Interfaces:**
- Consumes: authenticated employee; Prisma log models; employee approver configuration; `appendAudit`.
- Produces: `POST /api/logs/drafts`, `PUT /api/logs/:id`, `POST /api/logs/:id/submit`, `GET /api/logs/mine`, `GET /api/logs/:id`, role-scoped `GET /api/logs` with employee, department, date, color and pagination filters.
- Produces: `createOrUpdateDraft`, `submitLog`, `resubmitReturnedLog` transactional service methods.

- [ ] **Step 1: Write failing validation and API tests** — numbered non-empty items, unfinished reason required, one log per employee/date, only owner edits drafts/returned logs, submit creates green state and approval steps, and role-scoped query filters never return unauthorized logs.
- [ ] **Step 2: Write failing concurrent submission test** — send two requests for the same employee/date and assert one success, one conflict, one log and one submit audit event.
- [ ] **Step 3: Run log tests** — expected FAIL because log services are absent.
- [ ] **Step 4: Implement schemas, transactions, version snapshots and routes** — use database unique constraints as final duplicate protection.
- [ ] **Step 5: Run focused tests and commit** — expected PASS; `git commit -m "feat: add persistent daily work logs"`.

### Task 6: 多级审批、退回与红灰改色

**Files:**
- Create: `src/modules/approvals/approval.service.ts`, `approval.routes.ts`, `approval.schemas.ts`
- Test: `tests/unit/approvals/approval.service.test.ts`, `tests/integration/approvals/approval.routes.test.ts`, `tests/integration/approvals/approval.concurrent.test.ts`

**Interfaces:**
- Consumes: submitted logs and `ApprovalStep`; `listAuthorizedEmployeeIds`; `appendAudit`.
- Produces: `GET /api/approvals/pending`, `POST /api/approvals/:logId/approve`, `POST /api/approvals/:logId/return`, `POST /api/logs/:logId/change-color`.
- Produces: `approveCurrentStep(logId, leaderId, color: 'RED'|'GRAY', comment)` and `changeReviewedColor(logId, leaderId, color, reason)`.

- [ ] **Step 1: Write failing service tests** — assert same-day approval, strict approver order, red/gray only, no numeric score field, final archive and required reason for later color changes.
- [ ] **Step 2: Write failing authorization and concurrency tests** — guessed unauthorized log IDs return 403 without content; two concurrent approvals allow exactly one state transition and one audit event.
- [ ] **Step 3: Run approval tests** — expected FAIL because approval services are absent.
- [ ] **Step 4: Implement approval transactions, row/version conflict protection, return/resubmit state machine and audit writes**.
- [ ] **Step 5: Run focused tests plus Task 5 tests and commit** — expected PASS; `git commit -m "feat: add ordered red gray approval workflow"`.

### Task 7: 系统内提醒和定时任务

**Files:**
- Create: `src/modules/reminders/reminder.service.ts`, `reminder.routes.ts`, `reminder.jobs.ts`
- Create: `src/plugins/scheduler.ts`
- Test: `tests/unit/reminders/reminder.service.test.ts`, `tests/integration/reminders/reminder.jobs.test.ts`

**Interfaces:**
- Consumes: system settings, users, logs and approval events.
- Produces: `GET /api/reminders`, `POST /api/reminders/:id/read`; `runSubmissionReminderJob(now)` and `createEventReminder(input)`.

- [ ] **Step 1: Write failing reminder tests** — cover deadline warning, overdue employee/leader reminders, new approval, return, approval completion, read state and recipient isolation.
- [ ] **Step 2: Write failing rerun/restart test** — run the same job twice and assert one reminder per deduplication key.
- [ ] **Step 3: Run reminder tests** — expected FAIL because service and scheduler are absent.
- [ ] **Step 4: Implement idempotent reminder creation and scheduler registration using Beijing time**.
- [ ] **Step 5: Run focused tests and commit** — expected PASS; `git commit -m "feat: add in-app reminders"`.

### Task 8: 周期统计和奖惩确认

**Files:**
- Create: `src/modules/reports/report.service.ts`, `report.routes.ts`, `reward.service.ts`
- Test: `tests/unit/reports/report.service.test.ts`, `tests/integration/reports/report.routes.test.ts`

**Interfaces:**
- Consumes: logs, colors, submission timestamps, returns, authorization scope and `appendAudit`.
- Produces: `GET /api/reports/employees`, `/departments`, `/company`; `POST /api/rewards/confirm`.
- Produces: `buildPeriodStats(scope, start, end)` with counts, on-time rate, completion rate and return count; no score property.

- [ ] **Step 1: Write failing statistics tests** — assert Beijing date boundaries, zero denominator behavior, monthly/quarterly/yearly ranges, red/gray completion rate and absence of numeric scores.
- [ ] **Step 2: Write failing reward tests** — red greater than gray recommends reward; gray greater than or equal to red recommends improvement when gray exists; confirmation requires authorized leader and creates audit record.
- [ ] **Step 3: Run report tests** — expected FAIL because report services are absent.
- [ ] **Step 4: Implement aggregate queries, pagination and reward confirmation**.
- [ ] **Step 5: Run focused tests and commit** — expected PASS; `git commit -m "feat: add period reports and reward decisions"`.

### Task 9: 审计查询与统一错误处理

**Files:**
- Create: `src/modules/audit/audit.routes.ts`, `audit.service.ts`
- Create: `src/plugins/error-handler.ts`, `src/plugins/csrf.ts`
- Test: `tests/integration/audit/audit.routes.test.ts`, `tests/integration/security/error-handling.test.ts`

**Interfaces:**
- Consumes: audit events from Tasks 2–8; role guards.
- Produces: `GET /api/audit-events` with actor, employee, type, date and pagination filters; normalized error envelope `{code,message,requestId}`.

- [ ] **Step 1: Write failing audit tests** — filter accuracy, pagination, chronological stability, immutable history and restricted access.
- [ ] **Step 2: Write failing security/error tests** — malformed IDs, oversized text, SQL/XSS payloads, CSRF failure and internal exceptions must produce safe responses without stack traces.
- [ ] **Step 3: Run focused tests** — expected FAIL because routes and handlers are absent.
- [ ] **Step 4: Implement audit query, shared error mapping, request IDs, schema limits and CSRF protection**.
- [ ] **Step 5: Run focused tests, all API tests and commit** — expected PASS; `git commit -m "feat: add audit search and security error handling"`.

### Task 10: React 登录与通用应用壳

**Files:**
- Create: `src/web/api/client.ts`, `src/web/auth/AuthProvider.tsx`, `src/web/router.tsx`
- Create: `src/web/pages/LoginPage.tsx`, `ChangeInitialPasswordPage.tsx`
- Create: `src/web/components/AppShell.tsx`, `ReminderMenu.tsx`, `StatusBadge.tsx`
- Test: `tests/unit/web/auth.test.tsx`, `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: auth and reminder APIs from Tasks 3 and 7.
- Produces: role-aware routes, authenticated API client, reusable green/red/gray badge and reminder menu.

- [ ] **Step 1: Write failing component tests** — login errors, forced password change, logout, role-aware navigation and no exposure of unauthorized links.
- [ ] **Step 2: Write failing auth E2E test** — admin-created user logs in, changes initial password, refreshes and retains valid session.
- [ ] **Step 3: Run focused frontend tests** — expected FAIL because components are absent.
- [ ] **Step 4: Implement the application shell using the approved first-version visual language and accessible form controls**.
- [ ] **Step 5: Run focused tests, accessibility smoke check and commit** — expected PASS; `git commit -m "feat: add production login and app shell"`.

### Task 11: 员工工作台

**Files:**
- Create: `src/web/pages/employee/TodayLogPage.tsx`, `HistoryPage.tsx`, `EmployeeStatsPage.tsx`
- Create: `src/web/components/logs/WorkItemEditor.tsx`, `ApprovalProgress.tsx`
- Test: `tests/unit/web/employee-pages.test.tsx`, `tests/e2e/employee-flow.spec.ts`

**Interfaces:**
- Consumes: log, reminder and report APIs.
- Produces: daily numbered log editor, returned-log resubmission, history/result view and personal statistics.

- [ ] **Step 1: Write failing component tests** — add/remove numbered items, unfinished reason validation, save draft, green submitted state, red/gray result, comments and approval progress; assert no score UI.
- [ ] **Step 2: Write failing employee E2E test** — employee logs in, submits, refreshes on another browser context and sees persisted green log.
- [ ] **Step 3: Run focused tests** — expected FAIL because pages are absent.
- [ ] **Step 4: Implement responsive employee pages and preserve unsent form data across transient network failures**.
- [ ] **Step 5: Run focused tests and commit** — expected PASS; `git commit -m "feat: add employee worklog workspace"`.

### Task 12: 领导、管理层和管理员页面

**Files:**
- Create: `src/web/pages/leader/ApprovalPage.tsx`, `LogSearchPage.tsx`
- Create: `src/web/pages/management/DashboardPage.tsx`, `RewardsPage.tsx`
- Create: `src/web/pages/admin/UsersPage.tsx`, `DepartmentsPage.tsx`, `ApproversPage.tsx`, `SettingsPage.tsx`, `AuditPage.tsx`
- Test: `tests/unit/web/leader-admin-pages.test.tsx`, `tests/e2e/approval-admin-flow.spec.ts`

**Interfaces:**
- Consumes: approval, report, reward, user, department, setting and audit APIs.
- Produces: all remaining role pages from the spec.

- [ ] **Step 1: Write failing page tests** — red/gray-only approval, required comments/reasons, ordered approver display, filters, pagination, account reset, settings validation and audit query; assert no score UI anywhere.
- [ ] **Step 2: Write failing E2E flow** — admin creates employee and approvers; employee submits; two leaders approve in order; employee sees final red/gray result; management confirms reward decision.
- [ ] **Step 3: Run focused tests** — expected FAIL because pages are absent.
- [ ] **Step 4: Implement responsive role pages and confirmation states for consequential admin changes**.
- [ ] **Step 5: Run focused tests, full E2E suite and commit** — expected PASS; `git commit -m "feat: add leader management and admin consoles"`.

### Task 13: Docker、Nginx、备份与恢复

**Files:**
- Create: `Dockerfile`, `compose.yaml`, `.env.example`
- Create: `infra/nginx/default.conf`, `infra/scripts/backup-postgres.sh`, `infra/scripts/restore-postgres.sh`, `infra/scripts/backup-entrypoint.sh`
- Create: `docs/operations/deploy-linux.md`, `docs/operations/backup-restore.md`
- Test: `tests/infra/compose.test.ts`, `tests/infra/backup-restore.test.ts`

**Interfaces:**
- Consumes: production build and Prisma migrations.
- Produces: containers `app`, `postgres`, `nginx`, `backup`; health checks; backup files with 30-day retention.

- [ ] **Step 1: Write failing infrastructure tests** — compose config validity, no published PostgreSQL port, non-root app container, health checks, required secrets, backup retention and successful restore into an empty test database.
- [ ] **Step 2: Write failing error-path tests** — corrupted backup and unavailable database must return non-zero and write an actionable message.
- [ ] **Step 3: Run infrastructure tests** — expected FAIL because deployment files are absent.
- [ ] **Step 4: Implement multi-stage image, Nginx proxy limits, Compose services, backup/restore scripts and operator documentation** — initial HTTP port is 80; document domain/HTTPS upgrade before real employee passwords are used.
- [ ] **Step 5: Build images, run tests and commit** — expected PASS; `git commit -m "ops: add production deployment and backups"`.

### Task 14: 全量验收与服务器交付

**Files:**
- Create: `tests/e2e/acceptance.spec.ts`, `docs/operations/release-checklist.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: reproducible release checklist and verified deployment artifact.

- [ ] **Step 1: Write final acceptance tests** — cover every role, persistence, same-day approval, red/gray-only behavior, reminders, reports, audit, server restart and mobile viewport.
- [ ] **Step 2: Run `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e` and infrastructure tests** — expected all PASS with no warnings treated as errors.
- [ ] **Step 3: Run dependency/security checks and inspect container configuration** — resolve high/critical findings before release.
- [ ] **Step 4: Deploy to `101.132.147.80`, run migrations, create the first administrator through a one-time command, verify HTTP health and complete one backup/restore rehearsal**.
- [ ] **Step 5: Complete the release checklist and commit** — record deployed image/version and database migration; `git commit -m "release: verify production worklog system"`.

## Execution Notes

- Implementation must follow TDD for each task: failing test → minimal implementation → passing focused tests → full relevant suite.
- Database-changing tasks must use migrations; never mutate production tables manually.
- Secrets such as `SESSION_SECRET`, database password and initial administrator password must never be committed or printed.
- Deployment to the provided server requires SSH access details and explicit authorization at execution time.
- Because the current workspace is not a Git repository, Task 1 initializes Git inside the new formal-version project before any implementation commit.

