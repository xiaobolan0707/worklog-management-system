#!/bin/sh
# 工作日志系统 · 离线镜像升级（不编译）
# 前置：docker load -i worklog-local-app-20261113-linux-amd64.tar.gz
# 用法：
#   sh deploy-offline.sh --dry-run   备份 + 迁移，不切换镜像
#   sh deploy-offline.sh             备份 + 迁移 + 切换
#   sh deploy-offline.sh --rollback  回滚到升级前镜像
#
# 思路：离线镜像里自带的是旧迁移目录，直接启动会撞车。
# 这里用 docker commit 做一层派生镜像，只覆盖 /app/prisma/migrations 为幂等版本，
# 全程不执行 pnpm/vite/tsc，内存占用几十 MB。
set -eu
umask 077

PROD_DIR=${PROD_DIR:-/opt/worklog}
PROJECT=${PROJECT:-worklog-system}
BASE_IMAGE=${BASE_IMAGE:-worklog-local-release:20261113}
MODE=${1:-}
STAMP=$(date +%Y%m%d%H%M%S)
BACKUP_DIR=${BACKUP_DIR:-/root/worklog-backup-$STAMP}
NEW_TAG="worklog-system-app:offline-$STAMP"
APP_IMAGE="worklog-system-app:latest"

detect_compose() {
  for f in compose.yaml docker-compose.yml docker-compose.yaml; do
    [ -f "$PROD_DIR/$f" ] && { printf '%s\n' "$PROD_DIR/$f"; return 0; }
  done
  return 1
}

# 按 compose 标签找容器，不假设服务名，也不依赖 compose 文件存在
find_cid() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -1
}

list_services() {
  docker ps -a --format '{{.Names}}  {{.Label "com.docker.compose.service"}}  {{.Status}}' \
    --filter "label=com.docker.compose.project=$PROJECT"
}

switch_app() {
  APP_SERVICE=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$APP_CID")
  COMPOSE_FILE=$(detect_compose) || {
    echo "在 $PROD_DIR 找不到 compose 文件，无法用 compose 重建；请手工执行 docker restart 前先确认" >&2
    exit 1
  }
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$APP_SERVICE"
}

need_root() { [ "$(id -u)" = "0" ] || { echo "请用 root 执行"; exit 1; }; }

health_check() {
  i=0
  while [ "$i" -lt 40 ]; do
    curl -fsS http://127.0.0.1/health >/dev/null 2>&1 && return 0
    i=$((i + 1))
    sleep 2
  done
  return 1
}

rollback() {
  echo "[回滚] 恢复升级前镜像"
  [ -f "$BACKUP_DIR/previous-image-id" ] || { echo "缺少 $BACKUP_DIR/previous-image-id" >&2; exit 1; }
  docker tag "$(cat "$BACKUP_DIR/previous-image-id")" "$APP_IMAGE"
  APP_CID=$(find_cid app)
  [ -n "$APP_CID" ] || { echo "找不到 app 容器" >&2; list_services >&2; exit 1; }
  switch_app
  health_check && echo "[回滚] 完成" || { echo "[回滚] 失败，请人工介入" >&2; exit 1; }
}

need_root

if [ "$MODE" = "--rollback" ]; then
  LAST=$(ls -dt /root/worklog-backup-* 2>/dev/null | head -1 || true)
  [ -n "$LAST" ] || { echo "找不到备份目录"; exit 1; }
  BACKUP_DIR=$LAST
  rollback
  exit 0
fi

docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || {
  echo "未找到基础镜像 $BASE_IMAGE" >&2
  echo "请先执行：docker load -i worklog-local-app-20261113-linux-amd64.tar.gz" >&2
  exit 1
}

echo "[1/6] 备份数据库到 $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
PG_CID=$(find_cid postgres)
[ -n "$PG_CID" ] || {
  echo "找不到 postgres 容器（project=$PROJECT）。当前项目下的容器：" >&2
  list_services >&2
  exit 1
}
docker exec "$PG_CID" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -w -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip >"$BACKUP_DIR/worklog.sql.gz" || true
SIZE=$(wc -c <"$BACKUP_DIR/worklog.sql.gz" | tr -d ' ')
if [ "$SIZE" -lt 1024 ]; then
  echo "备份只有 ${SIZE} 字节，中止" >&2
  exit 1
fi
gzip -t "$BACKUP_DIR/worklog.sql.gz"
echo "      备份完成：${SIZE} 字节"

echo "[2/6] 记录当前镜像"
APP_CID=$(find_cid app)
[ -n "$APP_CID" ] || {
  echo "找不到 app 容器（project=$PROJECT）。当前项目下的容器：" >&2
  list_services >&2
  exit 1
}
PREV_IMAGE=$(docker inspect -f '{{.Image}}' "$APP_CID")
echo "$PREV_IMAGE" >"$BACKUP_DIR/previous-image-id"
docker tag "$PREV_IMAGE" "worklog-system-app:rollback-$STAMP"

echo "[3/6] 生成派生镜像（仅覆盖迁移目录，不编译）"
# commit 会连容器启动参数一起固化，必须把基础镜像的 ENTRYPOINT/CMD/USER 还原回去，
# 否则新镜像会变成 "sh -c sleep 900"，app 起不来。
BASE_ENTRY=$(docker inspect -f '{{json .Config.Entrypoint}}' "$BASE_IMAGE")
BASE_CMD=$(docker inspect -f '{{json .Config.Cmd}}' "$BASE_IMAGE")
BASE_USER=$(docker inspect -f '{{.Config.User}}' "$BASE_IMAGE")
[ "$BASE_CMD" != "null" ] || { echo "基础镜像没有 CMD，无法还原，中止" >&2; exit 1; }
case "$BASE_USER" in ""|null) BASE_USER=root ;; esac
echo "      基础镜像 ENTRYPOINT=$BASE_ENTRY CMD=$BASE_CMD USER=$BASE_USER"

SCRATCH=$(docker run -d --user root --entrypoint sh "$BASE_IMAGE" -c 'sleep 900')
trap 'docker rm -f "$SCRATCH" >/dev/null 2>&1 || true' EXIT INT TERM
docker cp prisma/migrations/. "$SCRATCH":/app/prisma/migrations
docker exec "$SCRATCH" chown -R node:node /app/prisma
if [ "$BASE_ENTRY" = "null" ]; then
  docker commit --change 'ENTRYPOINT []' --change "USER $BASE_USER" --change "CMD $BASE_CMD" \
    "$SCRATCH" "$NEW_TAG" >/dev/null
else
  docker commit --change "ENTRYPOINT $BASE_ENTRY" --change "USER $BASE_USER" --change "CMD $BASE_CMD" \
    "$SCRATCH" "$NEW_TAG" >/dev/null
fi
docker rm -f "$SCRATCH" >/dev/null
trap - EXIT INT TERM

CHECK_CMD=$(docker inspect -f '{{json .Config.Cmd}}' "$NEW_TAG")
[ "$CHECK_CMD" = "$BASE_CMD" ] || { echo "派生镜像 CMD 还原失败（$CHECK_CMD），中止" >&2; exit 1; }
echo "      已生成 $NEW_TAG（CMD 已还原）"

echo "[4/6] 在生产库上执行迁移（幂等，失败即中止）"
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$PG_CID" | awk '{print $1}')
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$PROD_DIR/.env" | cut -d= -f2-)
docker run --rm --entrypoint node --network "$NET" -e DATABASE_URL="$DATABASE_URL" "$NEW_TAG" \
  node_modules/prisma/build/index.js migrate deploy

if [ "$MODE" = "--dry-run" ]; then
  echo "[dry-run] 备份与迁移完成，按参数不切换镜像。"
  exit 0
fi

echo "[5/6] 切换镜像并重建 app"
docker tag "$NEW_TAG" "$APP_IMAGE"
switch_app

echo "[6/6] 健康检查"
if health_check; then
  echo "升级完成：$(date '+%F %T')"
  echo "回滚：sh deploy-offline.sh --rollback"
else
  echo "健康检查失败，自动回滚" >&2
  rollback
  exit 1
fi
