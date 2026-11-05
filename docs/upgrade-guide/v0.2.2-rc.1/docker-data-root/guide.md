---
kind: upgrade-guide
description: "The Docker deployment mounts the application root at /data and prepares changed sources automatically."
---

# Docker application-root mount

English | [中文](guide.zh.md)

## Change

The Docker deployment uses `/data/source` instead of `/opt/dsh` and keeps dependencies in the checkout's `node_modules`. Mount the application root at `/data`, with a second mount preserving `/workspace`; the separate source, dependency and package-store mounts are removed. Startup automatically prepares missing or outdated builds and reuses matching builds.

## Migration

1. Stop `dsh` and back up the application root, including hidden credentials and local plugins, preserving ownership and permissions.
2. Keep the checkout at `/mnt/user/appdata/dsh/source`. Move `data/dependencies` to `source/node_modules`; remove the old empty mount-point directory first only if it is empty. Move the remaining children of `data/`, including hidden entries, to the application root. Stop if any destination already exists; do not merge or overwrite directories. The resulting `dsh/`, `workspace/`, `pnpm-store/`, `user/`, `cache/`, plugins and backups are siblings of `source/`.
3. Rebuild `dsh-companion` from `source/docker/`. Change `/data` to host `/mnt/user/appdata/dsh` and `/workspace` to host `/mnt/user/appdata/dsh/workspace`. Remove `/opt/dsh`, `/opt/dsh/node_modules` and `/pnpm/store` mappings, and remove any old `npm_config_store_dir` override. Reapply the container to select the rebuilt image.
4. Follow the [directory-permission instructions](../../../../docker/README.md#prepare-and-start), then start the container. The first startup rebuilds for the new paths. If preparation fails, fix the reported error before restarting; Web does not start with a failed build.
5. Confirm the startup log reports preparation followed by the Web token URL. Restart once without editing source: the log should report `DSH 构建已是最新，直接启动。` with no installation or compilation. The optional `docker/prepare.sh` command remains available for forced rebuilding.
