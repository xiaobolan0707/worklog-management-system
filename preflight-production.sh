#!/bin/sh
set -eu
app_dir=${1:-/opt/worklog}
cd "$app_dir"
printf '\n%s\n' '=== Running services ==='
docker compose ps
df -h "$app_dir"
app_id=$(docker compose ps -q app)
test -n "$app_id"
docker inspect --format 'image={{.Image}} project={{index .Config.Labels "com.docker.compose.project"}}' "$app_id"
docker inspect --format '{{range .Mounts}}{{println .Type .Destination}}{{end}}' "$app_id"
printf '\n%s\n' '=== Database schema and migration history (read only) ==='
docker compose exec -T postgres sh -ec 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN READ ONLY;
SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
FROM _prisma_migrations ORDER BY started_at;
SELECT table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('users','work_plans','employee_attachments','log_archives','plan_archives')
ORDER BY table_name, ordinal_position;
ROLLBACK;
SQL
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-timers --all 'worklog-weekly-archive*' --no-pager
fi
