---
description: "构建本地 dsh-companion 镜像，在 Unraid 私有配置挂载源码运行，并维护持久化数据和浏览器认证。"
kind: "deployment-guide"
---

# Docker 部署

[English](README.md) | 中文

## 摘要

Dockerfile 构建名为 `dsh-companion` 的可复用 Node 24 环境，包含编译工具、Python 3 和 pip；DSH 源码随应用目录挂载，启动时按需构建。域名、代理和宿主目录由 Unraid Docker 页面在本地保存，仓库不提供 Compose 或个人环境文件。官方 token 认证、Web 设置和插件管理保持原样。

## 目录

- [构建与配置](#build-and-configure)
- [准备与启动](#prepare-and-start)
- [局域网和 Lucky](#lan-and-lucky)
- [数据与登录持久化](#data-and-login-persistence)
- [Python](#python)
- [更新与验证](#updates-and-verification)
- [开发备注](#dev-note)

<a id="build-and-configure"></a>
## 构建与配置

将应用根目录 `/mnt/user/appdata/dsh` 整体映射到 `/data`。完整 Linux checkout 放在 `source/`，Linux 依赖放在 `source/node_modules/`；运行数据、工作区和缓存与源码目录并列。镜像从源码在本机构建，不推送到镜像仓库；构建上下文仅含 Dockerfile，不包含源码、凭据和个人设置。

```text
/mnt/user/appdata/dsh/
├── source/
├── dsh/
├── workspace/
├── pnpm-store/
├── user/
└── cache/
```

```sh
cd /mnt/user/appdata/dsh/source
docker build -t dsh-companion docker/
```

在 **Docker → 添加容器** 中设置以下字段。镜像的 `node` 账户固定为 UID 99/GID 100，home 为 `/data/user`，不需要 PUID/PGID 环境变量。Post Arguments 留空，使用镜像默认的 `serve` 命令。Unraid 支持在[容器编辑页面](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/)配置路径、端口和变量。

| 字段 | 值 |
|---|---|
| Name | `dsh` |
| Repository | `dsh-companion`（本地 `latest` 标签） |
| Network type | Bridge |
| 端口 | 容器 TCP 3080 → 宿主 TCP 3080 |
| WebUI | `http://[IP]:[PORT:3080]` |
| Icon URL | [DSH PNG](#container-icon) |
| Extra Parameters | `--pids-limit 2048 --security-opt seccomp=unconfined --security-opt systempaths=unconfined` |

在 Unraid 添加以下两个可写映射。checkout 和依赖、缓存目录必须允许 99:100 写入；不要复用 Mac、Windows 的 node_modules 或原生产物。已有 `plugins/` 仍通过 `/data/plugins` 访问。

| 容器路径 | 在 Unraid 选择的宿主路径 |
|---|---|
| `/data` | `/mnt/user/appdata/dsh` |
| `/workspace` | `/mnt/user/appdata/dsh/workspace` |

在 Unraid 编辑页面添加运行时变量，不把个人取值写进仓库。Dockerfile 已提供 DSH_HOME、DSH_AGENTS_HOME、HOME 和 XDG_CACHE_HOME。

| 变量 | 用途 |
|---|---|
| `DSH_PUBLIC_URL` | 浏览器使用的完整局域网或 Lucky HTTPS 根地址，包括非标准端口 |
| `DSH_TRUSTED_HOSTS` | 逗号分隔的额外浏览器 authority；公告地址使用域名时，加入局域网 IP 和端口 |
| `TZ` | 使用的时区 |
| `HTTP_PROXY`、`HTTPS_PROXY` | 可选的出站代理 |
| `NODE_USE_ENV_PROXY` | Node 需要使用配置的代理时设为 `1` |
| `NO_PROXY` | 使用代理时填写 localhost、回环地址和 NAS 局域网 IP |

两项安全参数允许在缺少 Landlock 的 Unraid 内核上使用非 root bubblewrap namespace。它们会减弱 Docker 外层限制，但不授予 privileged 模式或 SYS_ADMIN（[实测说明](https://github.com/MeiXu6693/dsh-docker/blob/main/docs/sandbox.md)）。不要默认添加 Docker socket 或无关的 NAS、appdata 挂载。此部署不需要旧镜像的密码、访问名单、UV 和远程账号登录变量。

<a id="container-icon"></a>
### 容器图标

在 Unraid 容器编辑页面的高级视图，将 **Icon URL** 设置为下面的官方 DSH PNG。链接固定到发布 tag，已于 2026-11-05 核验返回 HTTP 200、image/png、1104×1104。链接直接使用上游应用图标。

```text
https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.2.2-rc.1/apps/desktop/resources/icon.png
```

下面三个图标合集目前包含 DeepSeek 品牌图标；检查完整仓库文件列表后，没有找到 DeepSeek Harness/DSH 专用条目。以下已核验的 PNG 可作备选，但它们是 DeepSeek 通用标识，不是 DSH 专用图案：

| 合集 | PNG 链接 | 尺寸 |
|---|---|---|
| [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) | [deepseek.png](https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/deepseek.png) | 695×512 |
| [selfh.st Icons](https://github.com/selfhst/icons) | [deepseek.png](https://raw.githubusercontent.com/selfhst/icons/main/png/deepseek.png) | 512×512 |
| [HD-Icons](https://github.com/xushier/HD-Icons) | [deepseek-1.png](https://raw.githubusercontent.com/xushier/HD-Icons/main/border-radius/deepseek-1.png) | 1024×1024 |

<a id="prepare-and-start"></a>
## 准备与启动

调整已有 `dsh` 容器前，先停止并备份数据与工作区。原有嵌套布局按[挂载迁移说明](../docs/upgrade-guide/v0.2.2-rc.1/docker-data-root/guide.zh.md)整理。容器的 DSH_HOME 仍为 `/data/dsh`，项目路径仍为 `/workspace`。保留隐藏凭据文件、所有者和权限，不要让两个容器同时使用同一份数据。

首次 Apply 前，在 Unraid 主机上初始化 checkout 和运行目录。root 克隆的 checkout 需要将内部文件（包括 `.git`）的所有者设为 99:100，供 Git 和构建使用。不要递归修改现有 `dsh/` 凭据：

```sh
mkdir -p /mnt/user/appdata/dsh/{pnpm-store,user,cache,workspace}
chown 99:100 /mnt/user/appdata/dsh /mnt/user/appdata/dsh/{pnpm-store,user,cache,workspace}
chown -hR 99:100 /mnt/user/appdata/dsh/source
```

Apply 并启动容器后，它会检查构建记录、Git 提交、操作系统、架构、Node 版本和主要产物。记录缺失、损坏或过期时自动准备，构建匹配时直接启动，不执行安装和编译。首次成功启动前先关闭自动重启，避免构建失败后循环重试。

准备过程安装锁定依赖、构建原生辅助程序和应用产物、执行聚合类型检查，最后记录构建结果并启动 Web。准备失败或期间提交变化时，不保留成功记录，也不启动 Web；修复日志中的错误后再启动。成功后开启 Unraid 自动启动，并可在 Extra Parameters 增加 `--restart=unless-stopped`。包 store 的锁以状态 75 拒绝并发构建或服务。

需要强制重建时，在 checkout 中执行 `sh docker/prepare.sh dsh`。这个可选维护命令停止已配置容器，复用其本地镜像 ID、用户、挂载和环境；成功或失败都保持容器停止，成功后再启动。复制的环境暂存在权限为 0600 的临时文件中，成功或失败后都会删除。Docker 管理员仍可查看容器设置，这不是加密的秘密存储。

<a id="lan-and-lucky"></a>
## 局域网和 Lucky

除 DSH_TRUSTED_HOSTS 外，DSH 还会自动信任 DSH_PUBLIC_URL 的 authority。因此只要 DSH_TRUSTED_HOSTS 仍包含局域网 IP:端口，公告 Lucky 域名不会取消局域网访问。这些地址检查不能替代官方浏览器认证。

在 Lucky 中使用 HTTPS 域名根路径，反代到 NAS 局域网 IP 的 3080 端口。保留原始 Host（包括浏览器访问端口）与 Origin，透传 Cookie、Set-Cookie 和 WebSocket upgrade，不缓存认证页面或 API 响应。Lucky 默认支持 WebSocket（[文档](https://lucky666.cn/docs/modules/web/)）。不支持子路径部署。

每个浏览器或 Companion 首次打开容器日志中完整的 `dsh web:` token URL。局域网登录使用同一个当前 token 和局域网根地址。局域网与域名分别建立 Cookie。缺少认证返回 401，API Host/Origin 被拒绝返回 403。Web 设置与插件管理使用官方 API；只有在服务器本机打开设置文件的原生操作在非 loopback 页面隐藏。

将发布端口限制在局域网与 Lucky 范围内。局域网 HTTP 和 HTTP 后端连接明文传输 bearer 凭据，Lucky HTTPS 保护外部连接。官方 HTTP 监听器不会根据转发头推断 Secure Cookie；若 Lucky 支持，可只在 HTTPS Cookie 响应上增加 Secure。

<a id="data-and-login-persistence"></a>
## 数据与登录持久化

保持挂载数据和容器路径稳定。整体备份应用根目录时，可排除可重建的 `source/node_modules/`、`pnpm-store/`、`cache/` 和源码生成产物。保留 `dsh/`（包括已安装的 profile 依赖）、`workspace/`、`user/`、本地插件和源码未提交改动。`/data/dsh` 保存会话、凭据、设置、profile 和已安装插件，`/data/dsh/agents` 保存共享 agents 数据。`/data/user` 是用户 home，`/data/cache` 保存缓存，`/workspace` 保存项目和 agent 产物。源码依赖与构建记录位于 `/data/source/node_modules`，不在镜像内。

每次 DSH 进程重启都会更换启动 token。已有 Cookie 通常继续有效，因为签名密钥保存在 `/data/dsh/.credentials.yaml`，默认绝对有效期为 30 天。Cookie 过期、authority 或监听器 TLS 协议改变、签名密钥被替换，都需要重新登录。停止服务后备份完整 data 与 workspace，包括隐藏文件，保留所有者和凭据文件的严格权限。

<a id="python"></a>
## Python

镜像安装系统 Python 3 和 pip，不创建或启用虚拟环境，不需要 UV_PYTHON_INSTALL_DIR、UV_PYTHON_BIN_DIR 或 UV_CACHE_DIR。容器以 UID 99 运行，在运行中容器控制台使用下列命令，将包安装到持久化用户 home。Debian 将系统解释器标记为外部管理，因此即使使用 --user，也需要明确添加 --break-system-packages（[pip 文档](https://pip.pypa.io/en/stable/cli/pip_install/#cmdoption-break-system-packages)）。

```sh
python3 --version
python3 -m pip install --user --break-system-packages requests
```

uv 是独立的包、环境及 Python 版本管理器（[官方文档](https://docs.astral.sh/uv/)）。镜像不安装 uv 或 uvx；MCP server 或项目若明确调用它们，仍需另行安装。存在 Python 3 不等于支持 uv 命令。不会删除旧 uv 安装留下的数据。

<a id="updates-and-verification"></a>
## 更新与验证

同步或 rebase 挂载的 checkout 前先停止 `dsh`，随后启动即自动准备更新后的源码。普通重启复用匹配的构建。Dockerfile 变化时重建环境镜像，并在 Unraid 重新应用容器以选择新本地镜像。Node、pnpm、系统工具变化时，先执行 `sh docker/prepare.sh dsh` 强制准备，再启动。不要从镜像仓库强制拉取这个仅本地存在的镜像。

源码更新通过 Git 提交判断。存在未提交修改、新增未跟踪源码，或删除了检查范围以外的生成产物时，使用强制准备；检查范围包括 CLI、Web 入口和依赖锁文件。准备期间不要编辑或更新源码。升级 DSH 前先备份，因为数据迁移可能使恢复旧 checkout 不足以降级。

准备后，从 checkout 根目录运行定向检查。宿主脚本测试用假的 Docker CLI 检查配置复用、构建前停止、错误传播和临时文件清理。Web 测试以隔离数据启动真实构建的 profile，检查局域网和域名认证、Cookie 隔离与重启后的 token 轮换。

```sh
node --test docker/tests/*.test.mjs
```

还需在实际 Unraid 主机检查 `docker exec dsh python3 --version`、pip 安装包、沙箱命令、两个浏览器入口、插件安装与启停及移除、WebSocket 重连，以及重建容器后的登录和数据保留。本地脚本、API 检查不能代替真实 Docker、Lucky 验证。官方参考：[公开部署](../docs/user/guide/public-deployments.zh.md)和[浏览器认证](../packages/client/connection/README.zh.md#browser-authentication-and-request-trust)。

<a id="dev-note"></a>
## 开发备注

无。
