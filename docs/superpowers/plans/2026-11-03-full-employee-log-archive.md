# Full Employee Log Archive Implementation Plan

> Execute inline using the existing standalone archive tools; keep application code and database unchanged.

**Goal:** 用户要求立即将系统目前存在的全部员工工作日志及关联数据备份至现有私有 OSS。

**Design:** 增加显式 --all-history 选项，复用只读一致性快照、11 类 CSV/JSONL、ZIP 流、OSS 回读验证；不按工作日期过滤，因此包括本周、草稿及可能预填的未来工作日期。文件名 employee-logs_full_asof_YYYYMMDDTHHMMSSZ.zip，manifest 记录实际最早/最晚工作日期和快照时刻。采用独立 last-full-* 回执，不推进每周成功检查点。扩展严格对象名校验以支持此文件，原365天清理复用，不申请新权限。

**Alternatives:** 逐周补导会遗漏未结束的本周；数据库全库备份包含本次未要求的账号安全信息；全量业务日志 ZIP 最符合本次范围。

**Files:** weekly-employee-logs-20261103/{weekly_archive.py,weekly_oss.mjs,README.md,SHA256SUMS}; work/test_weekly_{job.py,oss.mjs,archive_postgres.py}; 新部署包和执行回执。

- [x] 写测试并确认全量导出当前周、快照并发隔离、OSS名称/保留校验、每周检查点隔离的失败。
- [x] 实现全量入口和对象名校验，运行已有及新增归档测试、真实 PostgreSQL/OSS SDK 测试。
- [x] 校验并更新服务器归档脚本，执行全量快照，流式回读核对计数、字节和SHA。
- [x] 检查原定时任务与应用健康，提供实际对象路径和结果文档。
