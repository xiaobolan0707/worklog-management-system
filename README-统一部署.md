# 工作日志系统 · 统一部署包（2026-11-16）

本包在 2026-11-13 本地版基础上做了**迁移统一**：10 条数据库迁移全部改写为幂等写法，同一套迁移既能初始化空库，也能叠加在现有生产库上执行，不需要再为线上单独维护一套迁移。

内容物：

- 应用源码与 Docker 构建文件（`Dockerfile`、`compose.yaml`、`compose.preview.yaml`）
- `prisma/migrations/`：已幂等化的 10 条迁移
- `deploy-production.sh`：现网增量升级脚本（备份 → 构建 → 先迁移 → 再切镜像 → 失败自动回滚）
- `preflight-production.sh`：只读预检
- `infra/`：Nginx 配置、自签证书脚本、备份脚本

## 一、迁移统一做了什么

原有的 5 条迁移使用的是 Prisma 直出的非幂等 DDL（`CREATE TYPE` / `CREATE TABLE` / `ADD COLUMN`），在已有对象的库上必然报 `already exists`。本包改为：

| 原写法 | 统一后 |
|---|---|
| `CREATE TYPE "X" AS ENUM (...)` | `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` |
| `CREATE TABLE "x"` | `CREATE TABLE IF NOT EXISTS "x"` |
| `CREATE [UNIQUE] INDEX "i"` | `CREATE [UNIQUE] INDEX IF NOT EXISTS "i"` |
| `ALTER TABLE ... ADD COLUMN "c"` | `ADD COLUMN IF NOT EXISTS "c"` |
| `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` | `DO $$ ... EXCEPTION WHEN duplicate_object ...` |
| `DROP INDEX "i"` | `DROP INDEX IF EXISTS "i"` |
| 清理孤立工作计划的 `DELETE` / `UPDATE` | 置于列存在性判断内，缺列时整体跳过 |

因此：**空库可建，老库可增量补齐**，迁移失败不会留下半成品。

## 二、上传与校验

把压缩包与 `.sha256` 上传到 Workbench 登录用户目录，然后：

```sh
sha256sum -c worklog-unified-20261116f.tar.gz.sha256
mkdir -m 700 "$HOME/worklog-unified-20261116f"
tar -xzf worklog-unified-20261116f.tar.gz -C "$HOME/worklog-unified-20261116f"
cd "$HOME/worklog-unified-20261116f"
sh preflight-production.sh /opt/worklog
```

## 三、现网增量升级（推荐）

在解包目录执行。脚本默认操作 `/opt/worklog` 与 compose 项目 `worklog-system`，可用环境变量 `PROD_DIR`、`PROJECT` 覆盖。

```sh
sh deploy-production.sh --dry-run   # 只备份 + 执行迁移，不切换镜像
sh deploy-production.sh             # 正式升级
sh deploy-production.sh --rollback  # 回滚到升级前镜像
```

脚本行为：

1. `pg_dump` 备份数据库，连同 `compose.yaml`、`.env` 一并落到 `/root/worklog-backup-<时间戳>/`，备份为空即中止；
2. 记录当前容器镜像 ID 并打 `rollback-<时间戳>` 标签；
3. 用本包源码构建新镜像；
4. **先在生产库上跑迁移**——失败则直接退出，运行中的旧版本不受影响；
5. 迁移成功后把新镜像打成 `worklog-system-app:latest` 并重建 app 容器；
6. 健康检查 80 秒不通过则自动回滚镜像。

## 四、全新实例（独立验收）

与 2026-11-13 包一致：需要 Docker Compose ≥ 2.24.4、OpenSSL 与两个空闲本机端口。项目名 `worklog-preview-20261116`，使用全新项目与数据卷。

```sh
set -eu
umask 077
project=worklog-preview-20261116
test ! -e .env
test -z "$(docker ps -aq --filter "label=com.docker.compose.project=$project")"
db_password=$(openssl rand -hex 24)
session_secret=$(openssl rand -hex 32)
printf 'POSTGRES_PASSWORD=%s\nDATABASE_URL=postgresql://worklog:%s@postgres:5432/worklog\nSESSION_SECRET=%s\nARCHIVE_LIFECYCLE_ENABLED=false\n' \
  "$db_password" "$db_password" "$session_secret" >.env
unset db_password session_secret
chmod 600 .env
sh infra/scripts/generate-self-signed-cert.sh
docker compose -p "$project" -f compose.yaml -f compose.preview.yaml build app
docker compose -p "$project" -f compose.yaml -f compose.preview.yaml up -d --wait --wait-timeout 240
curl -fsS --cacert infra/nginx/certs/fullchain.pem https://localhost:18443/health
```

## 六、离线镜像升级（不编译，适合低配机器）

当主机内存不足、`docker build` 会超时（`DeadlineExceeded`）时走这条路径。前提是已上传离线镜像。

```sh
sha256sum -c worklog-local-app-20261113-linux-amd64.tar.gz.sha256
docker load -i worklog-local-app-20261113-linux-amd64.tar.gz   # 得到 worklog-local-release:20261113
cd "$HOME/worklog-unified-20261116f"
sh deploy-offline.sh --dry-run   # 备份 + 迁移，不切镜像
sh deploy-offline.sh             # 正式切换
```

脚本不编译任何代码：以离线镜像为底座，用 `docker cp` 把本包幂等化的 `prisma/migrations` 覆盖进 `/app/prisma/migrations`，再 `docker commit` 出一层派生镜像。内存占用从 1 GB 降到几十 MB。

因为覆盖了迁移目录，容器启动时执行的是幂等迁移，不会撞上旧包里的非幂等 DDL。

## 七、上线后必须确认

- `COOKIE_SECURE` 与 `REQUIRE_HTTPS`：现网仍为 HTTP，`.env` 中须保持 `COOKIE_SECURE=false`、`REQUIRE_HTTPS=false`，否则登录会因 Secure Cookie 失效。
- 迁移执行前后各看一眼 `/root/worklog-backup-<时间戳>/worklog.sql.gz` 的大小，回滚依赖它。
- 自动档案生命周期默认关闭（`ARCHIVE_LIFECYCLE_ENABLED=false`），确认附件卷备份后再开启。
