---
description: "独立的 Electron 客户端，可连接远程 DeepSeek Harness 服务器，并与官方桌面应用同时运行。"
---

# DeepSeek Harness Companion

[English](README.md) | 中文

## 摘要

Companion 打开远程 DeepSeek Harness Web GUI，不启动本地 Host。它是此 fork 中的独立客户端，官方桌面应用的源码与更新配置保持不变。

## 目录

- [运行](#run)
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

便携版可执行文件写入 `companion/dist/`。打包复用现有桌面图标，不修改图标文件。

<a id="identity-and-storage"></a>

## 身份与存储

产品与可执行文件命名为 **DeepSeek Harness Companion**，应用与 Windows 任务栏 ID 为 `com.deepseek.harness.companion`。偏好和 Chromium 存储位于 Electron 的 `appData/DeepSeek Harness Companion`，包括 `remote-url.txt` 和 `persist:companion` 设备 Cookie 分区。该目录在申请单实例锁之前设定，因此可与官方本地客户端同时运行；再次启动 Companion 会聚焦它自己的窗口。Companion 不注册 `dsh://`，不安装 `dsh` 命令，也不使用官方更新源。

`remote-url.txt` 只写入服务器来源地址，不保存配对路径、查询参数和片段。请在需要获得设备 Cookie 的客户端内输入配对链接。关闭 Companion 不停止服务器上的任务。

<a id="maintenance-and-limits"></a>

## 维护与限制

fork 专属的代码、配置、依赖、测试和预期输出全部位于 `companion/`，并使用独立锁文件。合并上游桌面改动时通常涉及不同文件，但若上游增加同名目录，仍可能冲突。Electron 依赖升级、服务器配对或 Web 认证变化需要单独检查。官方原生桌面功能不会自动出现在 Companion 中，服务器 Web UI 的变化由服务器提供。

Companion 不提供桌面 preload、本地文件系统桥接、原生权限授权、本地账号引导、托盘或自动更新器。桌面壳包含中英文文案。Windows 便携包未签名；macOS 和 Linux 打包尚未配置或验证。

<a id="dev-note"></a>

## 开发说明

无。
