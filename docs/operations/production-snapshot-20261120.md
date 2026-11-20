# 2026 年 11 月 20 日生产版本快照

此分支保存当天从 `log.huikuaai.com` 核对的阿里云运行版本。源码来自服务器留存的 `worklog-unified-20261119a.tar.gz`。重新生成 Prisma 客户端并构建后，前端 3 个文件、后端 79 个文件与运行容器逐字节一致，Prisma 13 个文件也一致。

仓库中的 Compose、备份和恢复脚本取自线上部署目录。线上启用了 HTTPS、Secure Cookie 和无需邀请码的员工注册，档案自动回收任务处于关闭状态。重现注册配置时参见[员工自助注册](employee-registration.md)。

| 核对项 | SHA-256 |
| --- | --- |
| 源码发布包 | `3134eba8a29e880c19cd8c4a08eba529a129d4b778cdb5bb651932fb69569266` |
| 线上应用镜像 | `17543f98b75d1bdbc70ceb3bac29e29e42d1b1504ffba4cbe40141a5a11a18b7` |
| `dist/server` 文件清单 | `702c682aa7fd158d24713578d6eab644e2e9bbc9db542a4b2a38388b91f5130d` |
| `dist/web` 文件清单 | `ce4ceb3b2533fc9d87a1c20926e89aff8e39c6d79d56007aafbe1b242b4816ab` |
| `prisma` 文件清单 | `d7177d0040817248b2827770757f08113c46c75f03145dcd31d74b4a43431913` |

文件清单按相对于应用根目录的路径排序，每行采用 `sha256sum` 的格式。Git 保存源码、迁移和部署配置模板。生产数据库、附件、环境密钥、TLS 私钥及编译产物保留在其各自的部署或备份位置。
