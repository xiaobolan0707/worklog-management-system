#!/bin/sh
# 工作日志系统 · 现网增量升级
# 用法：
#   sh deploy-production.sh            执行升级
#   sh deploy-production.sh --rollback 回滚到本次升级前的镜像
#   sh deploy-production.sh --dry-run  只做备份与迁移预演，不切换镜像
#
# 设计原则：
#   1) 先备份，备份失败立即中止；
#   2) 迁移先于切换执行，迁移失败不触碰运行中的旧容器；
#   3) 切换后健康检查不通过，自动回滚镜像。
set -eu
umask 077

PROD_DIR=${PROD_DIR:-/opt/worklog}
PROJECT=${PROJECT:-worklog-system}
MODE=${1:-}
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP_DIR=${BACKUP_DIR:-/root/worklog-backup-$STAMP}
NEW_TAG="worklog-system-app:release-$STAMP"
OLD_TAG="worklog-system-app:rollback-$STAMP"
APP_IMAGE="worklog-system-app:latest"

compose() { docker compose -p "$PROJECT" -f "$PROD_DIR/compose.yaml" "$@"; }

need_root() { [ "$(id -u)" = "0" ] || { echo "请用 root 执行"; exit 1; }; }

# 备份必须显式带口令并禁止交互：compose exec -T 没有 TTY，pg_dump 一旦等密码就会永久挂起。
psql_exec() {
  compose exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -w -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

health_check() {
  i=0
  while [ "$i" -lt 40 ]; do
    if curl -fsS http://127.0.0.1/health >/dev/null 2>&1; then return 0; fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

rollback() {
  echo "[回滚] 恢复升级前的镜像"
  if [ ! -f "$BACKUP_DIR/previous-image-id" ]; then
    echo "找不到 $BACKUP_DIR/previous-image-id，无法自动回滚" >&2
    exit 1
  fi
  PREV=$(cat "$BACKUP_DIR/previous-image-id")
  docker tag "$PREV" "$APP_IMAGE"
  compose up -d --no-build --force-recreate app
  health_check && echo "[回滚] 完成，服务已恢复" || { echo "[回滚] 失败，请人工介入" >&2; exit 1; }
}

need_root

if [ "$MODE" = "--rollback" ]; then
  LAST=$(ls -dt /root/worklog-backup-* 2>/dev/null | head -1 || true)
  [ -n "$LAST" ] || { echo "找不到备份目录"; exit 1; }
  BACKUP_DIR=$LAST
  rollback
  exit 0
fi

echo "[1/7] 备份数据库、compose 与 env 到 $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
psql_exec | gzip >"$BACKUP_DIR/worklog.sql.gz" || true
cp "$PROD_DIR/compose.yaml" "$BACKUP_DIR/" 2>/dev/null || true
cp "$PROD_DIR/.env" "$BACKUP_DIR/.env" 2>/dev/null || true
BACKUP_SIZE=$(wc -c <"$BACKUP_DIR/worklog.sql.gz" | tr -d ' ')
if [ "$BACKUP_SIZE" -lt 1024 ]; then
  echo "备份文件只有 ${BACKUP_SIZE} 字节，判定失败，中止。" >&2
  echo "请手动确认：docker compose -p $PROJECT -f $PROD_DIR/compose.yaml exec -T postgres sh -c 'PGPASSWORD=\"\$POSTGRES_PASSWORD\" pg_dump -w -h 127.0.0.1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"' | gzip > /tmp/backup-test.sql.gz" >&2
  exit 1
fi
gzip -t "$BACKUP_DIR/worklog.sql.gz" || { echo "备份压缩包损坏，中止" >&2; exit 1; }
echo "      备份完成：$BACKUP_DIR/worklog.sql.gz（${BACKUP_SIZE} 字节）"

echo "[2/7] 记录当前镜像并打回滚标签"
APP_CID=$(compose ps -q app)
PREV_IMAGE=$(docker inspect --format '{{.Image}}' "$APP_CID")
echo "$PREV_IMAGE" >"$BACKUP_DIR/previous-image-id"
docker tag "$PREV_IMAGE" "$OLD_TAG"

echo "[3/7] 构建新镜像 $NEW_TAG"
docker build -t "$NEW_TAG" .

echo "[4/7] 在生产库上执行迁移（幂等；失败即中止，旧版本继续运行）"
NETWORK=$(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(compose ps -q postgres)")
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$PROD_DIR/.env" | cut -d= -f2-)
if ! docker run --rm --network "$NETWORK" -e DATABASE_URL="$DATABASE_URL" "$NEW_TAG" \
  node node_modules/prisma/build/index.js migrate deploy; then
  echo "迁移失败，未切换镜像，现网保持原状。日志见上。" >&2
  exit 1
fi

if [ "$MODE" = "--dry-run" ]; then
  echo "[dry-run] 备份与迁移已完成，按参数要求不切换镜像。"
  exit 0
fi

echo "[5/7] 切换镜像并重建 app 容器"
docker tag "$NEW_TAG" "$APP_IMAGE"
compose up -d --no-build --force-recreate app

echo "[6/7] 健康检查"
if health_check; then
  echo "[7/7] 升级完成：$(date '+%F %T')"
  echo "回滚命令：sh deploy-production.sh --rollback（备份目录 $BACKUP_DIR）"
else
  echo "健康检查失败，自动回滚" >&2
  rollback
  exit 1
fi
