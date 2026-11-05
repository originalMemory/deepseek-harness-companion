# Spec: electron-desktop-pet

## Why
- Companion 目前只打开远程 GUI；接入 NAS 已提供的透明 Live2D 独立页，让形象常驻桌面，并用头顶气泡展示后台回复。
- 复用已有登录、Gateway 观察器与未读状态，不增加聊天身份、连接或历史副本。

## Scope
- 本次仅改 `companion/`：桌宠窗口及桥、主 GUI 本地让位、现有完成通知的展示路由；沿用独立客户端构建与发布方式，不改官方桌面壳或 NAS 插件。
- 支持 Windows/macOS：透明无框、无阴影、置顶窗口，人物基准舞台 360×520 CSS px，窗口随人物比例和气泡高度调整；透明区穿透、人物轻点与拖动、气泡点击/滚动/关闭、多屏位置恢复。
- 人物支持滚轮及原生菜单缩放，范围 50%–150%，本机保存比例；气泡字号、宽度不跟随缩放。顶部留白按头部锚点与气泡正文所需高度计算，向上移动以紧凑后的可见内容布局约束工作区。
- 窗口以首次就绪及缩放后检查一次的实际 alpha 轮廓为基准，与当前气泡计算并集，四周保留 12px 基准边距；舞台可负向偏移以裁去透明画布。动画期间固定轮廓基准、窗口尺寸和舞台位置，不跟随每帧轮廓变化；命中穿透仍读取当前画面。
- 后续验证不经 Electron 或其他入口向真实模型/会话发送消息，不新开 AI 轮次；使用本地数据和布局测试。气泡不是本轮问题，不重新运行真实气泡通知验收。
- 应用菜单和托盘提供“显示桌宠”开关，应用菜单另提供“重置桌宠位置”；首次默认关闭，保存开关与独立窗口布局，重启恢复用户选择。无托盘时仍可从应用菜单关闭/找回桌宠。
- 关闭桌宠即停用桌宠模式，销毁窗口并恢复 GUI 形象和原生通知；桌宠模式开启但加载失败/不可见时保留未读，不自动退回系统通知、不因通知打开已关闭桌宠。失败保留用户开关选择，显示可操作错误，允许关闭再开启重试。
- 不做：新模型/素材、NAS API 或鉴权改造、自动朗读/TTS/口型、AI 改写、通知队列/ACK/重试补演、任意子路径反代支持、Linux 适配、打包发布或更新已安装应用。

## Plan
- [x] 增加桌宠本地设置与窗口管理器；接入主进程、应用菜单/托盘、本地化文案、启动恢复、独立布局保存和重置位置。
- [x] 增加独立 sandboxed pet preload 与构建入口；复用选定服务器及 `persist:companion` session，限定页面导航与 IPC 权限。
- [x] 接入 v1 页面桥、实际模型 readiness、显隐、原生命中穿透、拖动、DPI/zoom 换算及显示器变化恢复；为隐藏、重载、销毁、切服清理资源。
- [x] 接入主 GUI preload 的初始 host 属性与动态 host 消息；只在桌宠模型和窗口可用后让位，失败/关闭恢复，GUI 重载保持当前模式。
- [x] 在 `CompletionNotifications.show()` 的现有后台判断后分派气泡/原生通知；保留 outcome、去重、baseline、unread 与现有观察器，气泡点击恢复主 GUI。
- [x] 补充行为测试、owner-local 预期输出和真实 Electron 检查入口；同步 Companion README 双语说明，录制真实服务流程 GIF。
- [ ] 完成 Windows/macOS 的 OS 透明区穿透、拖动、混合 DPI、多屏和显示器断开人工验收。
- [x] 增加人物独立缩放、菜单入口与本机比例保存；替换固定顶部预留，验证气泡尺寸、滚动、命中和拖动不受缩放干扰。
- [x] 按实际可见轮廓裁剪窗口；覆盖不同缩放、气泡显示/隐藏、动画轮廓变化、屏幕边缘及透明区命中的固定边距验收。
- [x] 固定首次就绪/缩放后的单次轮廓结果；验证屏幕中央和边缘的动画不触发原生窗口与舞台更新，保留实时命中，不调用真实模型。

## Apply Notes
- 协议依据：本机 `/Users/illusion/dev/self/dsh-companion/docs/electron-pet-handoff.md`（Electron 桌宠交接 v1，2026-11-03）。实现前重读交接文档；上游协议缺失时报告错误，保持 GUI 可用，不新增 NAS 接口兜底。
- 现有落点：[主进程](../../../companion/src/main.ts)、[连接与共享 session](../../../companion/src/connection-window.ts)、[完成通知](../../../companion/src/completion-notifications.ts)、[主 GUI preload](../../../companion/preload/index.ts)、[托盘](../../../companion/src/tray.ts)。该需求属于单个 Companion 客户端增强，不改跨包能力或 Session 格式。
- pet 加载选定 origin 的 `/api/dsh-companion/avatar/pet`；不复制 pairing token，不另设 partition。`nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`、`webSecurity:true`；独立 preload 不注入标题栏/壁纸能力，不暴露 Node、文件、任意执行脚本或导航 API。
- 共享 session 的 permission handlers 由同一个所有者协调，保留主 GUI 精确窗口/main frame 的 clipboard 写权限；pet 不获得原生权限。所有 pet IPC 校验精确 sender、main frame、origin 与限定路径，校验并复制跨进程输入；禁止远程页任意弹窗或跳往其它页面。
- main → pet 的通知文本走 v1 纯数据 `postMessage`，不用字符串拼接脚本；page → preload 只接收交接文档限定的本地意图。查询 `getState()` 用固定脚本，`hitTest()` 只插入校验后的有限数字；异步结果须核对当前窗口/页面代次，拒绝旧页或旧服务器结果。
- `ready` 只表示桥可用；以首次 `model-ready` 或 `getState().ready` 判断模型。主 GUI 初始 `data-companion-avatar-host` 必须在插件浮层初始化前生效，再用 `host` 消息同步；若当前 preload 时序不保证，先解决时序再接管，不接受长期双模型。关闭、加载失败、renderer 崩溃或模型不可用时恢复 `host:'web'`，不改共享 `config.enabled`。
- pet 使用 `backgroundThrottling:false`；原生隐藏前发送 `visibility:false` 清气泡并暂停，恢复窗口后发送 `visibility:true`。开启模式时可 `showInactive()`，后台通知不抢焦点；主 GUI 隐藏后继续保留现有 Gateway 观察器。
- 原生 cursor 检查仅在 pet 显示且页面可查询时运行，最多一次在途查询；隐藏/重载/销毁立即停止并丢弃迟到结果。以 contentBounds、屏幕 DIP 和实际 viewport/zoom 换算 CSS 坐标，不直接使用外框偏移；查询失败按未命中并报告持续不可用状态。
- 透明区使用 `setIgnoreMouseEvents(true,{forward:true})`，实体/气泡恢复输入；拖动期间维持输入直到结束，不把整个页面设为原生拖拽区。只接受当前拖动序列的坐标，隐藏、失焦、重载、销毁结束拖动；人物拖动不触摸，轻点沿用页面 6px/同区域判定。
- 桌宠独立保存正常位置/尺寸，按当前 workArea 约束窗口；首次位置及“重置桌宠位置”使用主 GUI 所在显示器的右下角，不固定到系统主显示器。显示器断开、缩放变化和屏外坐标恢复可见。设置无效用默认布局并报告，写入失败保留当前可用窗口并反馈；不复用 GUI 的 `window-state.json`。
- 独立缩放仅由壳的 pet preload 调整 `#companion-pet-stage` 尺寸和偏移，复用 NAS runtime 的 ResizeObserver、归一化 alpha 轮廓、真实命中和头部锚点；不缩放整个 webContents 或气泡。窗口按缓存的基准轮廓和气泡加 12 CSS px 边距。基准在模型首次就绪、缩放后的首个匹配尺寸画面采样一次；动画不重新计算窗口或舞台位置，鼠标穿透仍实时命中。重新加载模型或有效舞台尺寸/页面 zoom 改变时重新校准。缩放围绕基准轮廓底部中心；空间不足时约束到当前工作区并保留气泡滚动。持久化窗口在首次有效轮廓后按原位置恢复，避免每次启动累积偏移。
- 通知保留现有 240 UTF-8 bytes preview；气泡标题沿用 `COMPANION_NAME`，时长 12000ms，仅纯文本。completed 用 preview/完成文案，error 用失败文案，aborted 静默，ended 不宣称成功；主 GUI 可见且聚焦时静默。
- 桌宠模式下同一完成只走气泡，不创建系统 `Notification`；模型未 ready、不可见、加载失败时仅保留 unread 与日志，不排队。新气泡替换旧气泡，隐藏/关闭/重载清空，不恢复旧通知。
- 气泡点击恢复并聚焦已有主窗口，不发送聊天。`sessionId` 只作导航线索；实现时核实 GUI 是否有可靠导航接口，没有则保留当前会话，不臆造 URL。气泡关闭/超时不清 unread，主 GUI 可见且聚焦才沿用既有规则清除。
- 切服先销毁旧 pet、桥、IPC、命中检查、拖动与监听，再按用户开关为新服务器握手；未完成登录时等待可用页面，不在 pet 新建登录。退出清理遵循应用实际退出结果，主 GUI 阻止退出时保留可操作入口。

## Verify
- [x] 执行 `pnpm --dir companion test`、`pnpm --dir companion build`、`pnpm --dir companion check`；现有窗口、壁纸、快捷键、通知、托盘测试通过，新增分支有针对性行为覆盖。
- [ ] 真实 Electron 加载选定 origin 的 pet 页面并复用登录；首次关闭、开关持久化、重启恢复、菜单/托盘找回、重置位置及设置读写失败均可观察。缺插件/未登录/模型失败不崩溃、不阻塞 GUI，并可重试。
- [ ] 模型就绪后 GUI 释放旧模型；桌宠关闭/失败恢复 GUI；分别重载 GUI/pet、切换模型质量、共享形象开关后，无长期双模型或永久空白。确认初始 host 属性的注入时序。
- [ ] Windows/macOS 真机分别验收透明/置顶/showInactive、多屏、混合 DPI、非 100% zoom、屏幕断开及屏外恢复；透明区能操作底层应用，移回实体重新接收输入，轻点可摸、拖动不触摸，气泡文字滚动/关闭/间隙命中正常。未执行的平台标为待验收。
- [ ] 后台 completed/error/ended 各显示一次对应纯文本气泡，aborted/历史重放/断线/主 GUI 聚焦均安静；桌宠模式系统 Notification 调用数为 0，关闭模式保留原通知，unread 不受展示失败影响。
- [ ] 连续通知替换、超时、手动关闭、长文、HTML 字符串、空白/越界消息均按 v1 行为处理；隐藏清空且恢复不补演，通知不唤醒已关闭桌宠、不触发模型/TTS/业务 POST。
- [ ] 气泡点击只恢复主 GUI；若接入 session 导航，验证跨会话通知精确打开原会话；否则验证当前会话不变。关闭按钮不触发恢复，点击/关闭不重复 settle 或清 unread。
- [ ] 拒绝其它窗口、子 frame、其它 origin、错误路径及非法 IPC 字段；pet 无文件/Node/clipboard 权限，主 GUI 合法 clipboard 写权限保持可用。
- [ ] 重复开关、重载、隐藏、renderer 崩溃、切服、退出后无残留 IPC/cursor timer/监听或旧页回调；旧服务器通知不得展示到新服务器，NAS 任务/历史/记忆不受影响。
- [ ] 用真实服务及现有模型流程录制开关、拖动、气泡与 GUI 恢复 GIF；本地 fixture 只证明壳逻辑，真机记录独立证明 OS 穿透与 DPI 行为。
- [ ] README 双语记录操作、通知模式、前置插件和限制；运行文档检查及 `git diff --check`，更新本 spec 验收状态前列出实际执行证据与待验收项。

### Evidence · 2026-11-03
- `pnpm --dir companion build`、`pnpm --dir companion check`、`pnpm --dir companion test` 通过；14 个测试文件、173 项测试。菜单双语预期输出位于 `companion/tests/expected/desktop-pet-*.json`。
- `node companion/scripts/check-window.mjs`、`node companion/scripts/check-pet.mjs`、`node companion/scripts/check-wallpaper.mjs` 在 macOS 的真实 Electron 上通过；pet 检查运行完整远程入口、权限分派与通知路由，使用本地页面和受控观察事件，不认证 OS 穿透或真实模型性能。
- `pnpm exec tsx scripts/run-oxlint.ts companion`、`pnpm run verify-translation-pairing companion/README.md`、Markdown 链接/换行/预算检查及 `git diff --check` 通过。已新增 `companion/CLAUDE.md` 导航并同步根目录索引。
- macOS 隔离临时配置复用现有登录连接 NAS，实际 Live2D 就绪；现有固定伴侣会话执行一轮真实模型回复“桌宠通知验收完成”，气泡展示成功，系统通知调用 0 次、unread 1 次，点击恢复主 GUI，关闭清空气泡，停用恢复 GUI 形象，未报告应用错误。未创建新聊天身份。
- 同一次真实服务/模型流程的 4 张截图编码为本地 `.artifacts/desktop-pet-8c47eq97/demo-opaque.gif`：360×680、9 秒、125770 bytes。透明截图以黑底合成，停留时间仅便于阅读，不表示模型响应耗时；已从编码后的 GIF 解帧检查气泡和关闭状态。未发布远程资产。
- `pnpm run test:docs` 为 20 通过、1 失败；`pnpm run doc-sync` 为 42 通过、1 失败。两者均被本次修改前已存在的 `python/sdk/uv.lock:113 commit-hash` 引用拦住，未修改该文件。
- 双屏位置回归：已安装应用的桌宠窗口由系统确认可见于主显示器 `(1080,1880)`，GUI 位于副显示器；用户确认桌宠在另一块屏。默认/重置选屏的旧逻辑使用 `getPrimaryDisplay()`，已改为 GUI 实际窗口匹配的显示器。回归测试先失败后通过；macOS 两块实际显示器上的 Electron fixture 验证重置会跟随已移到副屏的 GUI。未重新打包或替换安装版。
- 独立缩放复验：真实 NAS/Live2D 与一轮真实模型回复，分别测得 50%、100%、150% 的人物舞台为 180×260、360×520、540×780；三档气泡字体均为 14px、宽度均为 340px，常规短气泡顶部距窗口边缘约 20px。系统通知 0 次、unread 1 次，无应用错误。无气泡时移除额外气泡预留；本地 Electron fixture 验证原生滚轮只缩放人物、气泡滚轮保留阅读、比例保存/重置及紧凑布局靠近工作区顶部。
- 缩放演示位于本地 `.artifacts/pet-scale-p58h7znr/demo.gif`，只取同一次真实回复的 100%→50%→150% 三帧；原生截图按 1:1 像素补黑底到统一画布，不缩放截图中的气泡，停留时间不代表模型耗时。原始 `03-top` 帧早于布局稳定，未选入演示；屏幕顶部验收采用上述 Electron fixture 的已稳定几何检查。
- 轮廓裁剪复验：回归测试先观察到整画布宽 360px，期望可见轮廓加边距宽 240px 的失败；修复后通过。真实 Live2D 在 50%、100%、150% 的有/无气泡六个状态均已核对；边距目标 12 CSS px，待机动态采样约 9–14px，未随比例放大。无气泡时实测窗口约 127×237、225×451、333×663；气泡始终为 14px 字体、340px 宽。20 次待机采样的画布屏幕原点漂移为 0px。持久化使用人物轮廓布局，覆盖带气泡退出后的原位置恢复。Electron fixture 连续三次通过，并验证边缘裁剪、滚轮、气泡滚动和隐藏；点击恢复检查等待原生窗口获得焦点后再测试隐藏。
- 新裁剪演示为本地 `.artifacts/pet-contour-1ckdk0yz/demo.gif`，六帧来自同一次真实服务/模型运行，按 1:1 像素补黑底至统一画布；青框仅标记各帧实际原生窗口边界，框外黑底是演示对齐区。演示与临时登录副本清理互不影响；临时认证配置已删除，未打包、安装或发布远程资产。
- 防抖修正：旧实现每 80ms 重裁原生窗口并异步补偿页面偏移，屏幕边缘的工作区约束会实际推移人物。中央的最终画布原点采样不能证明无抖动。新回归在中央和屏幕边缘先复现窗口尺寸/位置变化，再验证动画期间 `setBounds` 与 `model-layout` 更新次数均不增加；缩放后的旧尺寸数据被忽略，首个匹配尺寸画面仅采样一次。实时命中测试仍通过。本轮只运行本地测试、构建和静态检查，未启动真实 Electron 会话、未向模型发送消息、未重做真实气泡验收。
- 未逐项通过的 Verify 保持未勾选；重点剩余为 Windows 真机、OS 透明像素输入、拖动、混合 DPI、多屏、屏幕断开和完整失败组合验收。GUI 不暴露供壳安全调用的精确会话导航接口，气泡点击保留当前会话。

## Status
- State: doing
- Archived: no
