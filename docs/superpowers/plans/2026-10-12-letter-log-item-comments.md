# 员工日志信纸与逐项批注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将员工日志改造成最少四项、可插图、带自动署名日期的双栏信纸，并让每位审批人针对每项提交批注后立即向员工显示。

**Architecture:** 在现有 `DailyLog -> LogItem -> ApprovalStep` 流程上扩展，不更换认证、审批链或部署方式。图片数组存入 `LogItem.images` JSON 字段，逐项批注数组存入 `ApprovalStep.itemComments` JSON 字段；前后端复用统一视图结构，保持已有颜色审批和退回逻辑。

**Tech Stack:** React 19、TypeScript、Fastify、Zod、Prisma 7、PostgreSQL、Vitest

**Spec:** `员工日志信纸与逐项批注功能需求说明书.docx`

## Global Constraints

- 新建日志默认生成编号 1 至 4 的四个事项，提交时至少四项有效事项。
- 每项文字不超过 2000 字；每项最多 6 张 JPG、PNG 或 WebP 图片，每张原文件不超过 10 MB。
- 员工姓名取当前登录账号，日志日期取日志日期，界面只读展示。
- 审批必须针对每一事项分别批注，单项批注不超过 1000 字。
- 每位审批人提交后，其姓名、角色、时间和逐项批注立即对员工可见，不等待审批链完成。
- 不新增第三方依赖，不改变现有红色/灰色审批含义及权限边界。

## Review Focus

- 少于四项或存在空事项时，草稿可保存但提交必须被前后端阻止。
- 图片类型、单张大小、单项数量和总请求大小必须在信任边界校验。
- 逐项批注必须覆盖当前日志全部事项，不能错位、缺项或提交未知事项。
- 多位审批人的批注必须追加显示并带审批人信息，不能覆盖前序记录。
- 退回后新版本仍可编辑，历史提交快照必须保留当时图片和事项内容。

---

### Task 1: 扩展日志与批注数据契约

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261012090000_letter_log_comments/migration.sql`
- Modify: `src/modules/logs/log.schemas.ts`
- Modify: `src/modules/logs/log.repository.ts`
- Modify: `src/modules/approvals/approval.schemas.ts`
- Modify: `src/modules/approvals/approval.service.ts`
- Modify: `src/app.ts`
- Test: `tests/unit/logs/log.validation.test.ts`
- Test: `tests/unit/approvals/approval.service.test.ts`
- Test: `tests/integration/logs/log.routes.test.ts`

**Interfaces:**
- Consumes: 现有日志草稿、提交与顺序审批接口。
- Produces: `LogItem.images: LogImage[]`、`ApprovalStep.itemComments: ItemComment[]` 以及带审批人姓名、角色、时间的日志响应。

- [ ] 写入验证测试：四项提交规则、图片格式/大小/数量、逐项批注完整性。
- [ ] 运行定向测试，确认因新字段和规则缺失而失败。
- [ ] 增加迁移、Prisma 字段、Zod 合约和仓储映射；草稿保存图片，版本快照保留图片。
- [ ] 扩展审批服务，审批与退回均保存逐项批注，并返回审批人显示信息和时间。
- [ ] 运行定向测试，确认通过。

### Task 2: 员工信纸编辑器

**Files:**
- Modify: `src/web/components/logs/WorkItemEditor.tsx`
- Create: `src/web/components/logs/LetterLog.tsx`
- Modify: `src/web/pages/employee/TodayLogPage.tsx`
- Modify: `src/web/styles.css`
- Modify: `src/web/employee.css`
- Test: `tests/unit/web/employee-pages.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `images` 日志项结构。
- Produces: 默认四项、图片选择/预览/删除、右下角自动署名日期和右侧评注栏的信纸编辑视图。

- [ ] 写入 UI 测试：默认四项、不可删到四项、图片预览、自动署名日期、锁定后完整信纸。
- [ ] 运行测试并确认当前界面无法满足。
- [ ] 实现最小信纸组件和编辑逻辑，草稿允许空项，提交时校验四项有效。
- [ ] 增加响应式及打印样式，运行 UI 测试。

### Task 3: 审批逐项批注与员工即时反馈

**Files:**
- Modify: `src/web/pages/leader/ApprovalPage.tsx`
- Modify: `src/web/pages/employee/HistoryPage.tsx`
- Modify: `src/web/components/logs/ApprovalProgress.tsx`
- Modify: `src/web/pages/leader/LogSearchPage.tsx`
- Test: `tests/unit/web/leader-admin-pages.test.tsx`
- Test: `tests/unit/web/employee-pages.test.tsx`
- Test: `tests/integration/approvals/approval.routes.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `itemComments`、审批人显示信息与 Task 2 的信纸组件。
- Produces: 审批页逐项输入并提交，员工历史页按事项即时显示所有已提交审批人的批注。

- [ ] 写入 UI 与路由测试：每项独立批注、完整信纸、提交载荷、员工端多审批人追加显示。
- [ ] 运行测试并确认失败原因是当前整篇单批注设计。
- [ ] 改造审批与历史页面，日志查询可进入完整信纸详情。
- [ ] 运行定向测试并修复回归。

### Task 4: 全量验证与部署产物

**Files:**
- Modify: `README.md`
- Create: `outputs/员工工作日志管理系统-信纸批注升级包.tar.gz`

**Interfaces:**
- Consumes: Tasks 1–3 的源码与迁移。
- Produces: 可构建、可迁移、可部署的升级包和说明。

- [ ] 运行 `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm prisma:validate`。
- [ ] 对测试失败逐项修复，不忽略既有失败。
- [ ] 更新功能说明和数据库迁移步骤。
- [ ] 打包排除 `node_modules`、构建缓存和本地密钥，并检查归档清单。
