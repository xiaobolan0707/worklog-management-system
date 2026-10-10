#!/bin/sh
set -eu

: "${PGHOST:?缺少 PGHOST}"
: "${PGDATABASE:?缺少 PGDATABASE}"
: "${PGUSER:?缺少 PGUSER}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if ! pg_isready -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; then
  echo "备份失败：数据库不可用，请检查 PostgreSQL 服务和连接配置。" >&2
  exit 20
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/worklog-$timestamp.dump"
partial_file="$backup_file.partial"
trap 'rm -f "$partial_file"' EXIT INT TERM

if ! pg_dump --format=custom --no-owner --no-privileges --file="$partial_file"; then
  echo "备份失败：pg_dump 未能导出数据库。" >&2
  exit 21
fi
if ! pg_restore --list "$partial_file" >/dev/null 2>&1; then
  echo "备份失败：新生成的备份文件无法校验。" >&2
  exit 22
fi

mv "$partial_file" "$backup_file"
trap - EXIT INT TERM
find "$BACKUP_DIR" -type f -name 'worklog-*.dump' -mtime +"$BACKUP_RETENTION_DAYS" -delete
echo "备份完成：$backup_file"
