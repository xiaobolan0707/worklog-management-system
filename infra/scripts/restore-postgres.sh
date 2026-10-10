#!/bin/sh
set -eu

backup_file="${1:-}"
if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "恢复失败：请提供存在的备份文件路径。" >&2
  exit 30
fi
if ! pg_restore --list "$backup_file" >/dev/null 2>&1; then
  echo "恢复失败：备份文件损坏或格式无效（invalid backup）。" >&2
  exit 31
fi
if ! pg_isready -h "${PGHOST:?缺少 PGHOST}" -p "${PGPORT:-5432}" -U "${PGUSER:?缺少 PGUSER}" -d "${PGDATABASE:?缺少 PGDATABASE}" >/dev/null 2>&1; then
  echo "恢复失败：数据库不可用（database unavailable）。" >&2
  exit 32
fi

if ! pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges --dbname="$PGDATABASE" "$backup_file"; then
  echo "恢复失败：数据库未能完整恢复，请保留日志并停止业务写入。" >&2
  exit 33
fi
echo "恢复完成：$backup_file"
