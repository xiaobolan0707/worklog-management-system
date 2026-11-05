# Weekly Employee Log Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每周一北京时间 09:00 将上一自然周员工工作日志以校验过的 ZIP 归档到现有私有 OSS，保留 365 天。

**Architecture:** 独立 Python 工具以 PostgreSQL 导出快照和 COPY 生成低内存 CSV/JSONL ZIP 流；现有应用容器内 Node/ali-oss 适配器上传并回读校验，独立的每日 02:15 任务执行仅限本工具前缀的保留清理。systemd 管理调度、锁、资源优先级和运行记录。

**Tech Stack:** Python 标准库、PostgreSQL 17、既有 Docker Compose/Node 24/ali-oss、systemd。

**Spec:** ../specs/2026-11-03-weekly-employee-log-archive-design.md

## Global Constraints

- OSS 前缀 worklog/weekly-employee-logs/，保留 365 天，仅临时处理，不持久落地 ZIP。
- 只读业务数据库；所有日志状态与颜色；图片原始 dataUrl 保留于 JSONL。
- 不修改应用镜像、数据库结构、原逐条档案或 IAM 权限。
- ZIP 为 employee-logs_YYYY-MM-DD_to_YYYY-MM-DD.zip；允许显式历史周修订后缀。

## Review Focus

- 北京时间周边界、跨年与本地 UTC 不一致：日期单元测试。
- 嵌入换行、引号、公式与大图片：CSV/JSONL 字节流和校验测试。
- 数据库并发修改：真实 PostgreSQL 导出快照测试。
- 导出/上传中断或缺尾帧：协议与 ZIP 完整性失败测试。
- 误删其他对象、精确 365 天与同名重跑：OSS 适配器模拟测试。

### Task 1: 一致性数据导出与 ZIP 流

**Files:** Create weekly-employee-logs-20261103/weekly_archive.py; Test work/test_weekly_archive.py and work/test_weekly_archive_postgres.py.

**Interfaces:** previous_week(now, week_start=None) 返回北京时间周边界；export_zip(snapshot, output) 写 ZIP 与完成尾帧；verify_zip(path) 校验计数、内部摘要及 CRC。

- [x] 先写周边界、CSV 引号/换行/公式、零记录、计数错误、ZIP 摘要测试并观察失败。
- [x] 实现只读导出快照、显式字段范围、流式 COPY、ZIP/manifest/SHA256SUMS 和失败清理。
- [x] 跑单元与真实 PostgreSQL 并发/字段/图片测试，不触及生产数据。

### Task 2: OSS 流交付与保留策略

**Files:** Create weekly-employee-logs-20261103/weekly_oss.mjs; Test work/test_weekly_oss.mjs.

**Interfaces:** 完成尾帧长度 512 字节；适配器以 stdin 消费 ZIP，校验尾帧和回读摘要，发布 .sha256/.receipt.json；probe 验证当前角色能力；check 验证既有对象；prune 只处理满 365 天的本工具对象。

- [x] 先测试有效/中断/篡改流、已有归档、拒绝越界删除与保留期边界。
- [x] 使用既有 ali-oss 和 ECS RAM 角色实现流上传与校验，不修改授权。
- [x] 在本地模拟存储跑端到端 ZIP 交付测试。

### Task 3: 调度、交付及生产首次执行

**Files:** Create install.sh, worklog-weekly-archive.service, worklog-weekly-archive.timer, README.md, verify instructions and release package under weekly-employee-logs-20261103/.

- [x] 安装器验证路径、依赖、现有健康和 OSS 探针；配置正确后启用 timer。
- [x] 验证 OnCalendar、幂等安装、重叠锁、非零失败及运行状态文件。
- [x] 上传小脚本到服务器，首次真实归档上一自然周，核对 OSS 回执、SHA-256 和下次调度时间。
- [x] 报告真实执行状态与任何权限阻塞，不将本地测试当作生产成功。

## Production acceptance — 2026-11-03

上一周 76 篇日志、306 条目已实际归档，ZIP 56,322,517 字节，SHA-256 c7a684663455c49bb118aa670578231ed7cfa42785cc7c7cf64d305ed6f145a3。用户明确批准指定目录最小 IAM 附加策略；work_log 已关联 WorklogArchiveEcsRole，线上探针与清理通过。两个 timer enabled/active，service 实跑 success/0，下次归档 2026-11-09 09:00、清理 2026-11-04 02:15 北京时间。详见每周员工日志归档执行结果-20261103.md。
