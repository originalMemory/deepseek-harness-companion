---
description: "独立的 Electron 客户端，可连接远程 DeepSeek Harness 服务器，并与官方桌面应用同时运行。"
---

# DeepSeek Harness Companion

[English](README.md) | 中文

## 摘要

Companion 打开远程 DeepSeek Harness Web GUI，不启动本地 Host。它是此 fork 中的独立客户端，官方桌面应用的源码与更新配置保持不变。

## 目录

- [运行](#run)
- [通知](#notifications)
- [托盘与运行状态](#tray-and-running-status)
- [身份与存储](#identity-and-storage)
- [维护与限制](#maintenance-and-limits)
- [开发说明](#dev-note)

<a id="run"></a>

## 运行

在仓库根目录安装此客户端自己的依赖并启动：

```sh
pnpm --dir companion install
pnpm --dir companion start
```

首次使用时输入服务器地址或配对链接，并在 Companion 内完成配对。以后启动会直接打开记住的服务器。通过 **DeepSeek Harness Companion → 更换服务器…** 输入其他地址或新的配对链接。连接失败时可重试、更换服务器或退出。窗口内导航限于选定来源；若服务器还公布了其他局域网或公网来源，请使用所选来源的配对链接。

检查并打包未签名的 Windows 便携应用：

```sh
pnpm --dir companion test
pnpm --dir companion build
pnpm --dir companion check
pnpm --dir companion package:win
```

便携版可执行文件写入 `companion/dist/`。打包复用现有桌面图标，不修改图标文件。`pnpm --dir companion package:mac` 配置了使用临时签名的 macOS ZIP 打包，需要在 macOS 上验证。

<a id="notifications"></a>

## 通知

Companion 在壳内观察网页现有的 Gateway WebSocket，不需要 NAS 插件、服务器修改、额外的认证连接、preload 或网页脚本补丁。窗口位于后台时，观察到回复结束可弹出系统原生通知。参照 nanobot，窗口在前台时不打扰，点击通知恢复并聚焦窗口，成功回复可附带最多 240 个 UTF-8 字节的纯文本预览。

持久化的 `turn/end` 事件可区分成功、失败和取消，已知取消不提示。对于其他后台会话，实时控制流可能只表明一轮运行已结束而不提供结束原因，因此通用通知只说明运行结束，不宣称成功。活跃的详细事件流优先于此回退。历史快照和单纯断线不触发提醒。每个远程窗口最多为 256 个会话保留最近一次结束的去重状态。仅观察同来源的 `/api/remote.mux` 和 `/remote/api/remote.mux` 通道；若其消息格式变化，需要更新 Companion。打开开发者工具期间暂停观察，关闭后需刷新远程页面以恢复通道订阅。观察或系统通知失败会被报告，正常浏览仍可使用。

<a id="tray-and-running-status"></a>

## 托盘与运行状态

Windows 复用官方桌面的鲸鱼 ICO 和打开、退出交互。macOS 在菜单栏使用从同一官方鲸鱼派生的模板图标。观察到有运行中的轮次时，Windows 托盘图标增加静态蓝点，macOS 在鲸鱼旁显示 `●`；悬停显示运行数量。基线或连接尚不可用时显示等待会话状态，不宣称空闲。当前官方桌面只有 Windows 托盘，没有 macOS 菜单栏图标或运行状态变图；这些扩展由 Companion 提供。

关闭远程窗口会隐藏到托盘，继续观察事件和接收通知。托盘可打开保留的窗口，其退出菜单和应用菜单会退出客户端。更换服务器会替换窗口，关闭首次地址输入窗口会取消启动。如果托盘创建失败或无法更新，窗口仍可访问，并保留关闭退出行为。托盘等应用确认退出后才销毁，网页阻止卸载时仍保留托盘。退出客户端后，服务器任务仍继续运行。

已提交的托盘资源使用 `node --import tsx/esm companion/scripts/render-tray-assets.mjs` 从官方源文件生成，需要父仓库已安装的开发依赖。独立客户端构建和运行不需要这些依赖。

<a id="identity-and-storage"></a>

## 身份与存储

产品与可执行文件命名为 **DeepSeek Harness Companion**，应用与 Windows 任务栏 ID 为 `com.deepseek.harness.companion`。偏好和 Chromium 存储位于 Electron 的 `appData/DeepSeek Harness Companion`，包括 `remote-url.txt` 和 `persist:companion` 设备 Cookie 分区。该目录在申请单实例锁之前设定，因此可与官方本地客户端同时运行；再次启动 Companion 会聚焦它自己的窗口。Companion 不注册 `dsh://`，不安装 `dsh` 命令，也不使用官方更新源。

`remote-url.txt` 只写入服务器来源地址，不保存配对路径、查询参数和片段。请在需要获得设备 Cookie 的客户端内输入配对链接。关闭 Companion 不停止服务器上的任务。

<a id="maintenance-and-limits"></a>

## 维护与限制

fork 专属的代码、配置、依赖、测试和预期输出全部位于 `companion/`，并使用独立锁文件。合并上游桌面改动时通常涉及不同文件，但若上游增加同名目录，仍可能冲突。Electron 依赖升级、服务器配对或 Web 认证变化需要单独检查。官方原生桌面功能不会自动出现在 Companion 中，服务器 Web UI 的变化由服务器提供。

Companion 不提供桌面 preload、本地文件系统桥接、原生权限授权、本地账号引导或自动更新器。桌面壳包含中英文文案。Windows 便携包未签名；macOS 使用临时签名，需要本机验证。Linux 打包尚未配置。

<a id="dev-note"></a>

## 开发说明

无。
