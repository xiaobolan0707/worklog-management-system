# 备份与恢复

`backup` 容器默认每天生成一个 PostgreSQL 自定义格式备份，写入 `postgres-backups` 卷；只有校验成功的临时文件才会改名为正式备份，默认保留 30 天。

## 手工备份与导出

```sh
docker compose exec backup /bin/sh /scripts/backup-postgres.sh
docker compose exec backup ls -lh /backups
docker compose cp backup:/backups/worklog-YYYYMMDDTHHMMSSZ.dump ./
```

至少每月把一份加密备份复制到服务器之外，并限制访问权限。

## 恢复演练

恢复会覆盖目标库内同名对象，执行前必须停止应用写入并再做一次现状备份：

```sh
docker compose stop app nginx backup
docker compose run --rm --entrypoint /bin/sh \
  -v "$(pwd)/worklog-YYYYMMDDTHHMMSSZ.dump:/restore.dump:ro" \
  backup /scripts/restore-postgres.sh /restore.dump
docker compose start app nginx backup
curl --fail http://127.0.0.1/health
```

损坏文件会在连接数据库前以非零状态退出；数据库不可用和恢复失败也会以不同非零状态退出并输出中文原因。恢复后应抽查管理员登录、日志数量、审批记录、提醒和审计记录。
