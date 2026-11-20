#!/bin/sh
set -eu

: "${PGHOST:?缺少 PGHOST}"
: "${PGDATABASE:?缺少 PGDATABASE}"
: "${PGUSER:?缺少 PGUSER}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
ARCHIVE_DIR="${ARCHIVE_DIR:-}"

if ! pg_isready -h "$PGHOST" -p "${PGPORT:-5432}" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; then
  echo "备份失败：数据库不可用，请检查 PostgreSQL 服务和连接配置。" >&2
  exit 20
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/worklog-$timestamp.dump"
partial_file="$backup_file.partial"
archive_file="$BACKUP_DIR/worklog-archives-$timestamp.tar.gz"
partial_archive="$archive_file.partial"
trap 'rm -f "$partial_file" "$partial_archive"' EXIT INT TERM

if ! pg_dump --format=custom --no-owner --no-privileges --file="$partial_file"; then
  echo "备份失败：pg_dump 未能导出数据库。" >&2
  exit 21
fi
if ! pg_restore --list "$partial_file" >/dev/null 2>&1; then
  echo "备份失败：新生成的备份文件无法校验。" >&2
  exit 22
fi

# N02：数据库与员工附件必须成对备份。数据库单独恢复会把附件卷里
# dump 之后上传的文件当成孤儿，因此两者在同一时间窗口内生成、同一批次落盘。
if [ -n "$ARCHIVE_DIR" ]; then
  if [ ! -d "$ARCHIVE_DIR" ]; then
    echo "备份失败：附件目录不存在：$ARCHIVE_DIR" >&2
    exit 23
  fi
  if ! tar -czf "$partial_archive" --exclude=.restore-in-progress -C "$ARCHIVE_DIR" .; then
    echo "备份失败：附件卷未能打包。" >&2
    exit 24
  fi
  if ! tar -tzf "$partial_archive" >/dev/null 2>&1; then
    echo "备份失败：附件备份无法校验。" >&2
    exit 25
  fi
fi

mv "$partial_file" "$backup_file"
if [ -f "$partial_archive" ]; then mv "$partial_archive" "$archive_file"; fi
trap - EXIT INT TERM
find "$BACKUP_DIR" -type f \( -name 'worklog-*.dump' -o -name 'worklog-archives-*.tar.gz' \) -mtime +"$BACKUP_RETENTION_DAYS" -delete
if [ -f "$archive_file" ]; then
  echo "备份完成：$backup_file 与 $archive_file"
else
  echo "备份完成：$backup_file（未配置 ARCHIVE_DIR，附件卷未备份）"
fi
