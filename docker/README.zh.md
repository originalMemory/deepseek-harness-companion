---
description: "构建本地 dsh-companion 镜像，在 Unraid 私有配置挂载源码运行，并维护持久化数据和浏览器认证。"
kind: "deployment-guide"
---

# Docker 部署

[English](README.md) | 中文

## 摘要

Dockerfile 构建名为 `dsh-companion` 的可复用 Node 24 环境，包含编译工具、Python 3 和 pip；DSH 源码另行挂载和构建。域名、代理和宿主目录由 Unraid Docker 页面在本地保存，仓库不提供 Compose 或个人环境文件。官方 token 认证、Web 设置和插件管理保持原样。

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

统一使用 `/mnt/user/appdata/dsh` 作为应用根目录，其下只分 `source/` 和 `data/`。完整 Linux checkout 放在 `source/`，运行数据、工作区、依赖和缓存放在 `data/`。镜像从源码在本机构建，不推送到镜像仓库；构建上下文仅含 Dockerfile，不包含源码、凭据和个人设置。

```text
/mnt/user/appdata/dsh/
├── source/
└── data/
    ├── dsh/
    ├── workspace/
    ├── dependencies/
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

在 Unraid 添加以下可写映射。统一的是宿主目录，容器内路径保持固定。checkout 和专用依赖、缓存目录必须允许 99:100 写入；不要复用 Mac、Windows 的 node_modules 或原生产物。

| 容器路径 | 在 Unraid 选择的宿主路径 |
|---|---|
| `/opt/dsh` | `/mnt/user/appdata/dsh/source` |
| `/opt/dsh/node_modules` | `/mnt/user/appdata/dsh/data/dependencies` |
| `/pnpm/store` | `/mnt/user/appdata/dsh/data/pnpm-store` |
| `/data` | `/mnt/user/appdata/dsh/data` |
| `/workspace` | `/mnt/user/appdata/dsh/data/workspace` |

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

调整已有 `dsh` 容器前，先停止并备份 data 与 workspace。把独立源码 checkout 放入 `source/`，把根目录旁的 `workspace/` 移入 `data/workspace/`；已有专用依赖和 store 也放入对应 data 子目录，再修改 Unraid 映射。现有 `data/dsh/` 原地保留，包括隐藏凭据文件、所有者和权限，不要再套一层 data/dsh。容器的 DSH_HOME 仍为 `/data/dsh`，项目路径仍为 `/workspace`。按需保留旧容器定义，不要让两个容器同时使用同一份数据。

首次 Apply 时先不要配置自动重启。初次 serve 可能以“找不到可读取的构建记录”退出，因为应用尚未准备。在 Unraid 主机上只初始化挂载根目录的所有者，再从源码 checkout 执行维护脚本：

```sh
cd /mnt/user/appdata/dsh/source
docker run --rm --pull=never --volumes-from dsh --user 0:0 --entrypoint sh dsh-companion -c 'chown 99:100 /opt/dsh/node_modules /pnpm/store /data /workspace'
sh docker/prepare.sh dsh
```

`prepare.sh` 读取已配置容器，停止它，再用相同的本地镜像 ID、用户、挂载和环境启动临时构建容器。复制的环境暂存在宿主机权限为 0600 的临时文件中，成功或失败后都会删除；脚本不打印这些值，也不写入仓库。Docker 管理员仍可查看容器设置，这不是加密的秘密存储。

准备过程安装锁定依赖、构建原生辅助程序和应用产物、执行聚合类型检查，最后记录构建结果。成功或失败都保持 `dsh` 停止。成功后从 Docker 页面启动它，开启 Unraid 自动启动，并可在 Extra Parameters 增加 `--restart=unless-stopped`。失败时先修复日志中的错误，再重新准备，不要直接启动。包 store 的锁以状态 75 拒绝并发构建或服务。

<a id="lan-and-lucky"></a>
## 局域网和 Lucky

除 DSH_TRUSTED_HOSTS 外，DSH 还会自动信任 DSH_PUBLIC_URL 的 authority。因此只要 DSH_TRUSTED_HOSTS 仍包含局域网 IP:端口，公告 Lucky 域名不会取消局域网访问。这些地址检查不能替代官方浏览器认证。

在 Lucky 中使用 HTTPS 域名根路径，反代到 NAS 局域网 IP 的 3080 端口。保留原始 Host（包括浏览器访问端口）与 Origin，透传 Cookie、Set-Cookie 和 WebSocket upgrade，不缓存认证页面或 API 响应。Lucky 默认支持 WebSocket（[文档](https://lucky666.cn/docs/modules/web/)）。不支持子路径部署。

每个浏览器或 Companion 首次打开容器日志中完整的 `dsh web:` token URL。局域网登录使用同一个当前 token 和局域网根地址。局域网与域名分别建立 Cookie。缺少认证返回 401，API Host/Origin 被拒绝返回 403。Web 设置与插件管理使用官方 API；只有在服务器本机打开设置文件的原生操作在非 loopback 页面隐藏。

将发布端口限制在局域网与 Lucky 范围内。局域网 HTTP 和 HTTP 后端连接明文传输 bearer 凭据，Lucky HTTPS 保护外部连接。官方 HTTP 监听器不会根据转发头推断 Secure Cookie；若 Lucky 支持，可只在 HTTPS Cookie 响应上增加 Secure。

<a id="data-and-login-persistence"></a>
## 数据与登录持久化

保持挂载数据和容器路径稳定。宿主可整体备份 `data/`，其中可重建的 `data/dependencies/`、`data/pnpm-store/` 和 `data/cache/` 可以排除。保留 `data/dsh/`（包括已安装的 profile 依赖）、`data/workspace/` 和 `data/user/`；源码的未提交改动另行备份。`/data/dsh` 保存会话、凭据、设置、profile 和已安装插件，`/data/dsh/agents` 保存共享 agents 数据。`/data/user` 是用户 home，`/data/cache` 保存缓存，`/workspace` 保存项目和 agent 产物。依赖与构建记录位于专用 Linux 挂载中，不在镜像内。

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

同步或 rebase 挂载的 checkout 前先停止 `dsh`。再次运行 `sh docker/prepare.sh dsh`，成功后从 Unraid Docker 页面启动。普通重启不安装依赖或构建。只有 Node、pnpm、系统工具变化时才重建环境镜像；重建后在 Unraid 重新应用容器以选择新本地镜像，再针对这个已配置镜像执行准备。不要从镜像仓库强制拉取这个仅本地存在的镜像。

缺少构建记录、源码提交或已跟踪改动变化，以及操作系统、架构、Node 版本不兼容时，服务拒绝启动。新增未跟踪源码或删除产物后需要主动准备。升级 DSH 前先备份，因为数据迁移可能使恢复旧 checkout 不足以降级。

准备后，从 checkout 根目录运行定向检查。宿主脚本测试用假的 Docker CLI 检查配置复用、构建前停止、错误传播和临时文件清理。Web 测试以隔离数据启动真实构建的 profile，检查局域网和域名认证、Cookie 隔离与重启后的 token 轮换。

```sh
node --test docker/tests/*.test.mjs
```

还需在实际 Unraid 主机检查 `docker exec dsh python3 --version`、pip 安装包、沙箱命令、两个浏览器入口、插件安装与启停及移除、WebSocket 重连，以及重建容器后的登录和数据保留。本地脚本、API 检查不能代替真实 Docker、Lucky 验证。官方参考：[公开部署](../docs/user/guide/public-deployments.zh.md)和[浏览器认证](../packages/client/connection/README.zh.md#browser-authentication-and-request-trust)。

<a id="dev-note"></a>
## 开发备注

无。
