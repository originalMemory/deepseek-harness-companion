---
description: "独立的 Electron 客户端，可连接远程 DeepSeek Harness 服务器，并与官方桌面应用同时运行。"
---

# DeepSeek Harness Companion

[English](README.md) | 中文

## 摘要

Companion 打开远程 DeepSeek Harness Web GUI，不启动本地 Host。它是此 fork 中的独立客户端，官方桌面应用的源码与更新配置保持不变。

## 目录

- [运行](#run)
- [窗口与快捷键](#window-and-shortcut)
- [背景轮播](#wallpaper)
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

首次使用时输入服务器地址或配对链接，并在 Companion 内完成配对。以后启动会直接打开记住的服务器。在 Windows 通过 **应用 → 更换服务器…**、macOS 通过 **DeepSeek Harness Companion → 更换服务器…** 输入其他地址或新的配对链接。连接失败时可重试、更换服务器或退出。窗口内导航限于选定来源；若服务器还公布了其他局域网或公网来源，请使用所选来源的配对链接。

检查并打包未签名的 Windows 便携应用：

```sh
pnpm --dir companion test
pnpm --dir companion build
pnpm --dir companion check
pnpm --dir companion package:win
```

便携版可执行文件写入 `companion/dist/`。打包复用现有桌面图标，不修改图标文件。`pnpm --dir companion package:mac` 构建使用本机签名的 macOS ZIP，不进行 Apple 公证。shell 或被 Git 忽略的 `companion/.env.local` 中的 `COMPANION_MAC_SIGNING_IDENTITY` 可选择已有钥匙串签名身份；均未设置时使用临时签名。参见 [.env.local.example](.env.local.example)，可运行 `security find-identity -v -p codesigning` 列出可用名称。配置的身份不可用时，命令会在退出 Companion 前停止。

在当前机器上退出、重新构建、更新并打开 Companion，可从仓库根目录运行：

```sh
pnpm update:companion
```

`pnpm --dir companion update` 不经父工作区入口运行同一命令；`pnpm update:desktop` 是 Companion 的别名。macOS 请求退出，等待已安装的 Companion 进程结束，构建并校验已签名 ZIP／应用，在 `/Applications/DeepSeek Harness Companion.app` 旁暂存完整副本，替换后从该准确路径打开。需要 `/Applications` 的写权限。替换失败会恢复旧应用；恢复也失败时保留并报告备份路径。Windows 仅终止 Companion 的本地进程树，重新构建 x64 便携可执行文件，再从 `companion/dist/` 启动新副本；不会更新存放在其他位置的副本。远程服务器任务继续运行。构建或签名失败会保留原应用文件，不会重新启动客户端。Windows 更新命令仍需在 Windows 上实际验证。

<a id="window-and-shortcut"></a>

## 窗口与快捷键

Windows 使用官方的一体化标题栏和应用/编辑菜单。macOS 保留内嵌红绿灯和应用菜单。页面保持 Web 布局和主题，不注入标题栏留白。macOS 仅将会话标题行设为拖拽区域（通常位于视口顶部下方 10–40px），对话视图标签行位于该区域之外。Windows 使用现有标题栏行。交互控件和弹层排除在拖拽区域之外，装饰性的 `aria-hidden="true"` 背景层不抵消拖拽区域。Companion 的拖拽样式和 Web 拖拽 watcher 使用同一个标题行选择器，因此外层标题栏不动时，内部标题行的变化仍会刷新 macOS 拖拽区域。沙箱 preload 直接导入官方的 Windows 外观同步、标题栏菜单和全屏同步实现，不设置 `data-platform`：该属性会选择官方原生键盘桥，而 Companion 使用 Web 快捷键和偏好。在 Windows 上，服务器需要提供对应的 Web UI 样式。标题栏 IPC 只接受所选来源的主框架，不提供文件系统或 Harness Host 访问能力。仅在标题栏拖拽区右键显示壳菜单，其他页面区域保留 Web 右键菜单；交互控件和覆盖层仍不属于拖拽区。

`Ctrl+Shift+E` 在窗口可见且获得焦点时隐藏窗口，否则恢复并聚焦窗口。唤起时保留当前会话和草稿，并在聊天输入框可见且可编辑时聚焦输入框；其他页面保留当前页面。不创建专用会话。全局快捷键不可用时会显示提示，请检查 nanobot 或其他应用是否已经占用。托盘唤起和再次启动客户端也会聚焦当前输入框。

远程窗口隐藏或关闭时，将普通窗口的位置和尺寸保存到 `window-state.json`，下次启动时恢复。最大化和全屏尺寸不会覆盖普通窗口的尺寸，恢复时会将窗口调整到当前显示器的可用工作区。首次输入服务器地址的窗口不会修改这些偏好；存储失败会显示提示，保存的数据无效时使用默认布局。

构建后可运行 `node companion/scripts/check-window.mjs`，通过临时配置目录和本地测试页面检查打包使用的远程窗口入口：Web 快捷键检测、认证页恢复入口、剪贴板权限、标题栏菜单和输入框聚焦。

<a id="wallpaper"></a>

## 背景轮播

在拖拽区的壳右键菜单中，点击与“更换服务器…”并列的“背景轮播…”，在弹窗内选择图片目录。入口打开独立的中文配置弹窗，可启停轮播、包含子目录，以及设置随机／文件名顺序、切换间隔、暗化、模糊和淡入淡出时长；点击“保存并应用”后生效。“下一张”和“重新扫描”也会保存并应用当前设置。默认不启用；选目录并保存后启用，每 30 分钟随机切换，不连续重复。配置保存在 Companion 配置目录的 `wallpaper.json`，更换服务器后仍使用同一配置。弹窗的位置和尺寸独立保存到 `wallpaper-window-state.json`，弹窗开着时直接退出应用也会记住；下次打开会调整到当前显示器的可用区域内。

此功能参照 [dsh-wallpaper-rotator](https://github.com/originalMemory/dsh-wallpaper-rotator) 的图片扫描和呈现方式，在壳内运行，不要求服务器安装插件，也不轮询服务器。支持 JPG、PNG、WebP、GIF、AVIF 和 BMP，最多收录 5000 张，递归深度最多六层，跳过隐藏文件、符号链接、空文件及大于 48 MiB 的图片。壳只向所选来源的隔离 preload 推送当前图片数据，不暴露目录读取接口；网页脚本可以读取显示在 DOM 中的壁纸，因此只选择愿意展示给该网页的图片。保存前先验证目录和图片能否在当前网页加载，失败时保留原配置及背景并显示原生提示；配置保存结果与图片显示结果分别反馈。关闭轮播会移除图层及背景样式并停止计时。

自动轮播遇到图片读取失败、加载失败或校验超时，会保留当前背景，并在配置的间隔后继续尝试其他图片。顺序轮播会越过本次失败的图片；随机轮播有其他候选时不会立即再次选择该失败图片。网页报告图片加载失败时也不会取消后续轮播。关闭窗口或停用壁纸仍会停止计时。

构建后运行 `node companion/scripts/check-wallpaper.mjs`，可通过真正的 Electron 窗口验证选目录、图片合成、下一张、刷新恢复、关闭恢复原背景及配置保存。此检查使用临时配置和本地页面；服务器的内容安全策略必须允许 `data:` 图片，自定义皮肤也可能通过不透明面板遮挡壁纸。

<a id="notifications"></a>

## 通知

Companion 在壳内观察网页现有的 Gateway WebSocket，不需要 NAS 插件、服务器修改或额外的认证连接。窗口位于后台时，观察到回复结束可弹出系统原生通知。参照 nanobot，窗口在前台时不打扰，点击通知恢复并聚焦窗口，成功回复可附带最多 240 个 UTF-8 字节的纯文本预览。

持久化的 `turn/end` 事件可区分成功、失败和取消，已知取消不提示。对于其他后台会话，实时控制流可能只表明一轮运行已结束而不提供结束原因，因此通用通知只说明运行结束，不宣称成功。活跃的详细事件流优先于此回退。历史快照和单纯断线不触发提醒。每个远程窗口最多为 256 个非运行会话保留去重状态，运行中的会话不受此限制。观察流终止后，没有其他存活流覆盖的运行状态会失效。仅观察同来源的 `/api/remote.mux` 和 `/remote/api/remote.mux` 通道；若其消息格式变化，需要更新 Companion。打开开发者工具期间暂停观察，关闭后需刷新远程页面以恢复通道订阅。观察或系统通知失败会被报告，正常浏览仍可使用。

<a id="tray-and-running-status"></a>

## 托盘与运行状态

Windows 复用官方桌面的鲸鱼 ICO 和打开、退出交互。macOS 在菜单栏使用从同一官方鲸鱼派生的模板图标。只要观察到运行中的轮次，Windows 托盘蓝点与 macOS 圆点就每 800 毫秒闪烁，不受远程窗口是否获得焦点或位于后台影响。两边圆点都叠加在既有图标尺寸内部；macOS 使用尺寸一致的普通屏和 Retina 模板图，闪烁及未读标记不会增加菜单栏图标宽度。后台观察到回复结束后保留未读圆点，直到远程窗口重新可见并获得焦点；未读提示独立于系统通知是否可用。悬停显示运行数量及未读状态。基线或连接尚不可用时显示等待会话状态，不宣称空闲。当前官方桌面只有 Windows 托盘，没有 macOS 菜单栏图标或运行状态变图；这些扩展由 Companion 提供。

关闭远程窗口会隐藏到托盘，继续观察事件和接收通知。托盘可打开保留的窗口，其退出菜单和应用菜单会退出客户端。更换服务器会替换窗口，关闭首次地址输入窗口会取消启动。如果托盘创建失败或无法更新，窗口仍可访问，并保留关闭退出行为。托盘等应用确认退出后才销毁，网页阻止卸载时仍保留托盘。退出客户端后，服务器任务仍继续运行。

已提交的托盘资源使用 `node --import tsx/esm companion/scripts/render-tray-assets.mjs` 从官方源文件生成，需要父仓库已安装的开发依赖。独立客户端构建和运行不需要这些依赖。

<a id="identity-and-storage"></a>

## 身份与存储

产品与可执行文件命名为 **DeepSeek Harness Companion**，应用与 Windows 任务栏 ID 为 `com.deepseek.harness.companion`。偏好和 Chromium 存储位于 Electron 的 `appData/DeepSeek Harness Companion`，包括 `remote-url.txt` 和 `persist:companion` 设备 Cookie 分区。该目录在申请单实例锁之前设定，因此可与官方本地客户端同时运行；再次启动 Companion 会聚焦它自己的窗口。Companion 不注册 `dsh://`，不安装 `dsh` 命令，也不使用官方更新源。

`remote-url.txt` 只写入服务器来源地址，不保存配对路径、查询参数和片段。请在需要获得设备 Cookie 的客户端内输入配对链接。关闭 Companion 不停止服务器上的任务。

<a id="maintenance-and-limits"></a>

## 维护与限制

Companion 的源码、配置、依赖、测试和预期输出位于 `companion/`，并使用独立锁文件；根包提供更新命令别名。合并上游桌面改动时通常涉及不同文件，但若上游增加同名目录，仍可能冲突。Electron 依赖升级、服务器配对或 Web 认证变化需要单独检查。官方原生桌面功能不会自动出现在 Companion 中，服务器 Web UI 的变化由服务器提供。

Companion 仅允许所选来源的主框架写入清洗后的剪贴板内容，拒绝剪贴板读取和其他原生权限。不提供本地文件系统桥接、本地账号引导或自动更新器。桌面壳包含中英文文案。标题栏 preload 在构建时从 fork 源码打包，合并上游标题栏改动后需要检查。Windows 便携包未签名；macOS 使用临时签名或配置的本机钥匙串身份，不进行公证。Linux 打包尚未配置。

<a id="dev-note"></a>

## 开发说明

无。
