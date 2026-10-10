#!/bin/sh
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
while true; do
  /bin/sh /scripts/backup-postgres.sh
  sleep "$interval"
done
