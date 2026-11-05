---
kind: upgrade-guide
description: "Docker 部署将应用根目录映射到 /data，并自动准备变化后的源码。"
---

# Docker 应用根目录挂载

[English](guide.md) | 中文

## 变更

Docker 部署使用 `/data/source` 代替 `/opt/dsh`，依赖放在 checkout 的 `node_modules` 中。应用根目录整体映射到 `/data`，第二个映射保留 `/workspace`；不再单独映射源码、依赖和包 store。启动时自动准备缺失或过期的构建，匹配时直接复用。

## 迁移

1. 停止 `dsh`，备份整个应用根目录，包括隐藏凭据和本地插件，并保留所有者和权限。
2. checkout 保留在 `/mnt/user/appdata/dsh/source`。把 `data/dependencies` 移到 `source/node_modules`；原挂载点目录仅在确认为空时先移除。将 `data/` 剩余子项（包括隐藏项）移到应用根目录。任何目标已存在时停止，不合并或覆盖目录。整理后的 `dsh/`、`workspace/`、`pnpm-store/`、`user/`、`cache/`、插件和备份与 `source/` 并列。
3. 用 `source/docker/` 重新构建 `dsh-companion`。将 `/data` 的宿主路径改为 `/mnt/user/appdata/dsh`，将 `/workspace` 改为宿主 `/mnt/user/appdata/dsh/workspace`。移除 `/opt/dsh`、`/opt/dsh/node_modules` 和 `/pnpm/store` 映射，以及旧的 `npm_config_store_dir` 覆盖值。重新应用容器以选择重建后的镜像。
4. 按[目录权限说明](../../../../docker/README.zh.md#prepare-and-start)初始化，然后启动容器。首次启动会按新路径重新构建。准备失败时先修复报告的错误再重启；构建失败时不启动 Web。
5. 确认启动日志先报告准备，再显示 Web token URL。源码不变时重启一次，日志应显示 `DSH 构建已是最新，直接启动。`，不执行安装和编译。可选的 `docker/prepare.sh` 命令仍可用于强制重建。
