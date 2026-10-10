# Linux 服务器部署

目标服务器：公网 `101.132.147.80`，主私网 `172.18.96.239`。应用只对外开放 Nginx 的 80 端口，PostgreSQL 不发布端口。

## 1. 准备服务器

安装 Docker Engine 与 Compose 插件，为部署目录设置仅管理员可写权限。安全组仅放行 SSH、80；配置域名与 HTTPS 后再放行 443。不要开放 5432。

## 2. 配置并启动

```sh
cp .env.example .env
chmod 600 .env
# 编辑 .env：替换数据库密码、DATABASE_URL 和 SESSION_SECRET
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1/health
```

应用容器每次启动会先执行数据库迁移。首次启动后，用一次性环境变量创建管理员：

```sh
docker compose run --rm \
  -e ADMIN_USERNAME='admin' \
  -e ADMIN_INITIAL_PASSWORD='请在终端中填写一次性强密码' \
  app pnpm prisma:seed
```

管理员首次登录必须修改初始密码，随后在系统内创建部门、员工账号和审批关系。

## 3. 上线安全边界

当前 Compose 是初始 HTTP 配置，只可用于安装验收。员工开始使用真实密码前，必须绑定公司域名、配置有效 TLS 证书，将 `COOKIE_SECURE=true`，并把 HTTP 永久跳转到 HTTPS。`.env`、数据库卷和备份卷不得打包外传。

## 4. 更新与回退

更新前先做人工备份并记录当前 Git 提交；再拉取指定版本，执行 `docker compose build` 和 `docker compose up -d`。数据库迁移只前进；若更新失败，保留数据库和备份卷，回到上一应用提交后重新构建，不得删除数据卷。
