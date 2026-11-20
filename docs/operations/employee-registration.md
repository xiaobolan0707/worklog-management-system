# 线上员工自助注册

2026 年 11 月 20 日，工作日志系统通过生产 `.env` 中的 `REGISTRATION_OPEN=true` 开放员工自助注册，无需邀请码。提交申请会创建一个停用的员工账号，管理员在「用户管理」启用后才能登录。

生产部署沿用 `/opt/worklog` 中的 Compose 文件和已经运行的应用镜像。仓库中的 [Compose 配置](../../compose.registration-open.yaml) 记录了公开申请所需的两个非敏感配置项，可在支持这两个变量的版本上明确启用注册。直接维护生产 `.env` 时，设置 `REGISTRATION_OPEN=true` 并将 `REGISTRATION_INVITE_CODE` 留空。

使用覆盖文件时，将它放在部署目录，并在应用配置的终端中运行 `export COMPOSE_FILE=compose.yaml:compose.registration-open.yaml`。

修改前备份 `.env`，核对 Compose 当前选中的应用镜像与正在运行的镜像一致，然后在部署目录应用配置：

```sh
docker compose config --quiet &&
docker compose up -d --no-deps --no-build --pull never --force-recreate --wait app &&
docker compose exec -T nginx nginx -s reload
```

核对线上接口：

```sh
curl --fail --silent --show-error https://log.huikuaai.com/api/auth/registration-mode
curl --fail --silent --show-error https://log.huikuaai.com/api/health
```

注册接口应返回 `"open":true` 和 `"inviteRequired":false`，健康接口应返回 `"status":"ok"`。如需关闭入口，将生产 `.env` 的 `REGISTRATION_OPEN` 改为 `false`，保持邀请码为空，然后重新应用配置。若使用 Compose 覆盖文件启用，则应用配置时移除该覆盖文件。
