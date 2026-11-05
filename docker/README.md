---
description: "Build the local dsh-companion image, configure its mounted-source runtime privately in Unraid, and maintain persistent data and browser authentication."
kind: "deployment-guide"
---

# Docker deployment

English | [中文](README.zh.md)

## Summary

The Dockerfile builds a reusable Node 24 environment named `dsh-companion`. It contains build tools, Python 3 and pip; DSH sources are mounted with the application directory and built when needed at startup. Unraid’s Docker page stores the domain, proxy and host-directory configuration locally; this repository contains no Compose file or personal environment file. Official token authentication, Web settings and plugin management remain unchanged.

## Table of Contents

- [Build and configure](#build-and-configure)
- [Prepare and start](#prepare-and-start)
- [LAN and Lucky](#lan-and-lucky)
- [Data and login persistence](#data-and-login-persistence)
- [Python](#python)
- [Updates and verification](#updates-and-verification)
- [Dev Note](#dev-note)

<a id="build-and-configure"></a>
## Build and configure

Mount the application root `/mnt/user/appdata/dsh` as `/data`. Put the complete Linux checkout in `source/`, with its Linux dependencies in `source/node_modules/`; runtime state, workspace and caches are siblings. The image is built locally from source and is not pushed to a registry. Its build context contains only the Dockerfile, excluding source, credentials and personal settings.

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

In **Docker → Add Container**, set the following fields. The image’s `node` account is fixed at UID 99/GID 100, with home `/data/user`; no PUID/PGID environment variables are needed. Leave Post Arguments empty so the image uses its default `serve` command. Unraid supports configuring paths, ports and variables in its [container editor](https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/managing-and-customizing-containers/).

| Field | Value |
|---|---|
| Name | `dsh` |
| Repository | `dsh-companion` (local `latest` tag) |
| Network type | Bridge |
| Port | Container TCP 3080 → host TCP 3080 |
| WebUI | `http://[IP]:[PORT:3080]` |
| Icon URL | [DSH PNG](#container-icon) |
| Extra Parameters | `--pids-limit 2048 --security-opt seccomp=unconfined --security-opt systempaths=unconfined` |

Add these two writable mappings in Unraid. The checkout and dependency/cache directories must be writable by 99:100. Do not reuse Mac/Windows node_modules or native artifacts. Existing plugins under `plugins/` remain accessible as `/data/plugins`.

| Container path | Host path to select in Unraid |
|---|---|
| `/data` | `/mnt/user/appdata/dsh` |
| `/workspace` | `/mnt/user/appdata/dsh/workspace` |

Add runtime variables in the Unraid editor; do not put personal values in repository files. The Dockerfile already supplies DSH_HOME, DSH_AGENTS_HOME, HOME and XDG_CACHE_HOME.

| Variable | Purpose |
|---|---|
| `DSH_PUBLIC_URL` | Full browser-facing LAN or Lucky HTTPS root, including a nonstandard port |
| `DSH_TRUSTED_HOSTS` | Additional browser authorities, comma-separated; include the LAN IP and port when the public URL uses a domain |
| `TZ` | Your time zone |
| `HTTP_PROXY`, `HTTPS_PROXY` | Optional outbound proxy |
| `NODE_USE_ENV_PROXY` | `1` when Node should use the configured proxy |
| `NO_PROXY` | When using a proxy: localhost, loopback addresses and the NAS LAN IP |

The two security options allow non-root bubblewrap namespaces on Unraid kernels without Landlock. They reduce Docker’s outer restrictions, but do not grant privileged mode or SYS_ADMIN ([measured explanation](https://github.com/MeiXu6693/dsh-docker/blob/main/docs/sandbox.md)). Do not add the Docker socket or unrelated NAS/appdata mounts by default. Old-image password, allowlist, UV and remote-sign-in variables are not needed for this setup.

<a id="container-icon"></a>
### Container icon

In Unraid’s advanced container editor, set **Icon URL** to the official DSH PNG below. It is pinned to a release tag and was verified on 2026-11-05 as HTTP 200, image/png, 1104×1104. The URL uses the upstream application icon directly.

```text
https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.2.2-rc.1/apps/desktop/resources/icon.png
```

The three icon collections below currently have DeepSeek brand icons; no dedicated DeepSeek Harness/DSH entry was found in their complete repository file lists. These verified PNG alternatives are generic DeepSeek marks, not DSH-specific artwork:

| Collection | PNG link | Dimensions |
|---|---|---|
| [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) | [deepseek.png](https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/deepseek.png) | 695×512 |
| [selfh.st Icons](https://github.com/selfhst/icons) | [deepseek.png](https://raw.githubusercontent.com/selfhst/icons/main/png/deepseek.png) | 512×512 |
| [HD-Icons](https://github.com/xushier/HD-Icons) | [deepseek-1.png](https://raw.githubusercontent.com/xushier/HD-Icons/main/border-radius/deepseek-1.png) | 1024×1024 |

<a id="prepare-and-start"></a>
## Prepare and start

Before changing an existing `dsh` container, stop it and back up its data/workspace. For the former nested layout, follow the [mount migration](../docs/upgrade-guide/v0.2.2-rc.1/docker-data-root/guide.md). The container’s DSH_HOME remains `/data/dsh`, and project paths remain `/workspace`. Preserve hidden credential files, ownership and permissions; never run two containers against the same data.

Before the first Apply, initialize the checkout and runtime directories from the Unraid host. A root-owned checkout needs its files, including `.git`, assigned to 99:100 so Git and the build can use it. Do not recursively change existing `dsh/` credentials:

```sh
mkdir -p /mnt/user/appdata/dsh/{pnpm-store,user,cache,workspace}
chown 99:100 /mnt/user/appdata/dsh /mnt/user/appdata/dsh/{pnpm-store,user,cache,workspace}
chown -hR 99:100 /mnt/user/appdata/dsh/source
```

Apply and start the container. It checks the saved build record, Git commit, OS, architecture, Node version and primary artifacts. A missing, malformed or outdated record triggers preparation automatically; a matching build starts directly without installation or compilation. Keep automatic restart disabled until the first successful startup so a failing build does not loop.

Preparation installs locked dependencies, builds native helpers and application artifacts, runs aggregate type checks, then records the build and starts Web. Failure or commit changes during preparation leave no successful record and do not start Web; fix the logged error and start again. After success, enable Unraid autostart and optionally add `--restart=unless-stopped` to Extra Parameters. The package-store lock rejects concurrent builds/serving with status 75.

For a forced rebuild, run `sh docker/prepare.sh dsh` from the checkout. This optional maintenance command stops the configured container and reuses its local image ID, user, mounts and environment. It leaves the container stopped on success or failure; start it after success. The copied environment uses a temporary mode-0600 file removed on either outcome. Docker administrators can inspect container settings; this is not encrypted secret storage.

<a id="lan-and-lucky"></a>
## LAN and Lucky

DSH automatically trusts the authority from DSH_PUBLIC_URL in addition to DSH_TRUSTED_HOSTS. Advertising the Lucky domain therefore does not remove LAN access when the LAN IP:port remains in the latter. These address checks do not replace official browser authentication.

In Lucky, serve the domain root over HTTPS and proxy to the NAS LAN IP on port 3080. Preserve the original Host (including the browser-facing port) and Origin, forward Cookie/Set-Cookie and WebSocket upgrades, and do not cache authenticated pages/API responses. Lucky supports WebSockets by default ([documentation](https://lucky666.cn/docs/modules/web/)). Subpath deployments are unsupported.

Open the full `dsh web:` token URL from container logs once in each browser/Companion. For LAN login, use the same current token with the LAN root. LAN and domain establish separate cookies. Missing authentication returns 401; rejected API Host/Origin returns 403. Web settings and plugin management use the official APIs; only the native “open settings file on the server” action is hidden off-loopback.

Restrict the published port to the LAN/Lucky. LAN HTTP and the HTTP backend leg carry bearer credentials without encryption; Lucky HTTPS protects the external leg. The official HTTP listener does not infer Secure cookies from forwarding headers. If supported, add Secure only on Lucky’s HTTPS cookie responses.

<a id="data-and-login-persistence"></a>
## Data and login persistence

Keep mounted data and container paths stable. Back up the application root; rebuildable `source/node_modules/`, `pnpm-store/`, `cache/` and generated source artifacts can be excluded. Keep `dsh/` (including installed profile dependencies), `workspace/`, `user/`, local plugins and uncommitted source edits. `/data/dsh` holds sessions, credentials, settings, profiles and installed plugins; `/data/dsh/agents` holds shared agents data. `/data/user` is the user home and `/data/cache` holds caches. `/workspace` holds projects and agent output. Source dependencies and build records live in `/data/source/node_modules`, not the image.

The launch token changes on every DSH process restart. Existing cookies normally remain valid because the signing secret persists in `/data/dsh/.credentials.yaml`, with a default absolute lifetime of 30 days. Cookie expiry, changed authority/listener TLS protocol, or a replaced signing secret needs a new login. Back up complete data/workspace while stopped, including hidden files; preserve ownership and restrictive credential-file permissions.

<a id="python"></a>
## Python

The image installs system Python 3 and pip, without creating or activating a virtual environment. No UV_PYTHON_INSTALL_DIR, UV_PYTHON_BIN_DIR or UV_CACHE_DIR is needed. As UID 99, install packages into the persistent user home using the commands below in the running container console. Debian marks its system interpreter externally managed, so pip needs the explicit --break-system-packages option even with --user ([pip documentation](https://pip.pypa.io/en/stable/cli/pip_install/#cmdoption-break-system-packages)).

```sh
python3 --version
python3 -m pip install --user --break-system-packages requests
```

uv is a separate package/environment/Python-version manager ([official documentation](https://docs.astral.sh/uv/)). The image does not install uv or uvx: an MCP server or project explicitly invoking either still needs that tool installed separately. Merely having Python 3 does not implement uv commands. Existing data from old uv installations is not deleted.

<a id="updates-and-verification"></a>
## Updates and verification

Stop `dsh` before syncing/rebasing the mounted checkout, then start it to prepare the updated source automatically. Normal restarts reuse a matching build. Rebuild the environment image for Dockerfile changes; after rebuilding, reapply the Unraid container to select the new local image. When Node/pnpm/system tools change, force preparation with `sh docker/prepare.sh dsh` before starting. Do not force-pull this local-only image from a registry.

Source updates are detected by the Git commit. Use forced preparation for uncommitted edits, new untracked source files or deleted generated artifacts other than the checked CLI, Web entry and dependency-lock files. Do not edit or update source during preparation. Back up before DSH upgrades because data migrations can prevent downgrade by checkout alone.

After preparation, run focused checks from the checkout root. The host-script tests use a fake Docker CLI to check settings reuse, stop-before-build, failure propagation and temporary-file cleanup. The Web test launches the real built profile with isolated data and checks LAN/domain authentication, cookie separation and token rotation after restart.

```sh
node --test docker/tests/*.test.mjs
```

On the actual Unraid host, also check `docker exec dsh python3 --version`, pip package installation, sandboxed commands, both browser entries, plugin install/enable/disable/remove, WebSocket reconnection and container recreation with persisted login/data. Local script/API checks do not substitute for real Docker/Lucky tests. Official references: [public deployment](../docs/user/guide/public-deployments.md) and [browser authentication](../packages/client/connection/README.md#browser-authentication-and-request-trust).

<a id="dev-note"></a>
## Dev Note

None.
