# 员工工作日志管理系统

面向 50 人以内项目研发型公司的正式版工作日志系统。员工不领取任务，只按天填写工作日志；提交后显示绿色，领导当天或次日核查并只选择红色（完成）或灰色（未完成）。系统完全取消数字评分。

## 主要功能

- 员工：使用双栏信纸填写至少四项当日工作，每项可插入 JPG、PNG 或 WebP 图片；姓名和日期由系统自动生成。
- 领导：查看完整信纸，针对每项工作分别批注，按审批顺序退回或进行红/灰定色。
- 批注反馈：每位审批人提交后，员工立即在对应工作项右侧看到审批人姓名、角色、时间和批注，不等待全部审批结束。
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

Windows 本机已安装并配置 Workbench CLI 时，可将 `scripts/deploy-one-click.ps1` 与升级包放在同一目录后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-one-click.ps1
```

脚本会依次校验升级包、上传、备份数据库和程序、构建容器、执行迁移并检查健康状态。先运行 `-ValidateOnly` 可只做本地校验，不连接或修改服务器。

从旧版本升级时，启动应用前必须保留数据库备份。应用启动执行 `prisma migrate deploy` 后，会为日志事项增加图片字段、为审批步骤增加逐项批注字段；迁移不删除旧日志和旧批注。
