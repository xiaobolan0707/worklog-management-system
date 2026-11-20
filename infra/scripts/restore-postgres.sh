#!/bin/sh
set -eu

backup_file="${1:-}"
archive_file="${2:-}"
ARCHIVE_DIR="${ARCHIVE_DIR:-}"

if [ -z "$backup_file" ] || [ ! -f "$backup_file" ]; then
  echo "恢复失败：请提供存在的备份文件路径。" >&2
  exit 30
fi
if [ -n "$archive_file" ] && [ -z "$ARCHIVE_DIR" ]; then
  echo "恢复失败：恢复附件卷需要设置 ARCHIVE_DIR。" >&2
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

# N03：快照里包含会话与账号状态。恢复后立即吊销全部会话，
# 强制所有用户重新登录；离职/停用状态仍需按下文提示人工复核。
if ! psql --dbname="$PGDATABASE" -v ON_ERROR_STOP=1 -c 'DELETE FROM sessions;' >/dev/null; then
  echo "恢复完成但会话失效失败：请手动执行 DELETE FROM sessions; 并停止对外服务。" >&2
  exit 34
fi

if [ -n "$ARCHIVE_DIR" ]; then
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$ARCHIVE_DIR"
  # N02：数据库与附件卷可能不匹配。先写恢复标记，让附件清理任务暂停，
  # 直到运维核对完数据库与实际文件后再删除该标记。
  : > "$ARCHIVE_DIR/.restore-in-progress"
  if [ -n "$archive_file" ]; then
    if [ ! -f "$archive_file" ] || ! tar -tzf "$archive_file" >/dev/null 2>&1; then
      echo "恢复失败：附件备份缺失或无法校验；数据库已恢复，请保留恢复标记并人工处理。" >&2
      exit 35
    fi
    staging="$ARCHIVE_DIR/.restore-$timestamp"
    if ! mkdir -p "$staging" || ! tar -xzf "$archive_file" -C "$staging"; then
      echo "恢复失败：附件解包失败；数据库已恢复，请保留恢复标记并人工处理。" >&2
      exit 36
    fi
    # 以备份内容覆盖同名文件；不在备份中的新文件保留给运维核对，不在此处删除。
    find "$staging" -maxdepth 1 -type f -exec mv -f {} "$ARCHIVE_DIR"/ \;
    rm -rf "$staging"
    # app 容器以 node 用户（UID 1000）读写附件，恢复后归还属主，否则附件无法读取。
    if ! chown -R 1000:1000 "$ARCHIVE_DIR"; then
      echo "恢复失败：附件已解包但属主修正失败，请手工 chown -R 1000:1000 $ARCHIVE_DIR。" >&2
      exit 37
    fi
    echo "附件已恢复：$archive_file"
  fi
  echo "恢复完成：$backup_file"
  echo "数据库与附件卷核对无误后，删除 $ARCHIVE_DIR/.restore-in-progress 以恢复自动清理。"
else
  echo "恢复完成：$backup_file"
  echo "未配置 ARCHIVE_DIR：如该系统使用员工附件，请手工核对附件卷并保持清理任务暂停。"
fi
