# 员工工作日志管理系统

面向 50 人以内项目研发型公司的正式版工作日志系统。员工不领取任务，只按天填写工作日志；提交后显示绿色，领导当天或次日核查并只选择红色（完成）或灰色（未完成）。系统完全取消数字评分。

## 主要功能

- 员工：逐项填写当日工作、未完成原因、草稿、提交、历史、审批进度和个人统计。
- 领导：按审批顺序核查、退回、红/灰定色、改色留痕和权限范围内日志查询。
- 管理层：全公司日志与月度、季度、年度红灰统计，确认奖金/惩罚决定。
- 管理员：创建账号与初始密码、部门、多个审批人顺序、截止时间、提醒规则和审计查询。
- 系统：站内提醒、首次登录改密、会话与 CSRF 防护、登录限流、不可变审计记录、定时备份。

## 技术与目录

Node.js 24、Fastify、React、PostgreSQL、Prisma、Nginx、Docker Compose。业务源码在 `src/`，数据库模型和迁移在 `prisma/`，自动测试在 `tests/`，Linux 运维说明在 `docs/operations/`。

## 本地验证

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm prisma:generate
pnpm verify
```

端到端测试只针对已准备好账号和数据的运行中环境：设置 `E2E_RUN=1`、`E2E_BASE_URL` 及 `E2E_ACCEPTANCE_*` 账号变量后运行 `pnpm test:e2e`。

## Linux 上线

按照 [Linux 部署说明](docs/operations/deploy-linux.md) 配置服务器；备份与恢复参见 [备份恢复说明](docs/operations/backup-restore.md)。初始 HTTP 只用于安装验收，真实员工密码投入使用前必须绑定域名并启用 HTTPS。
