/** Remote-client copy follows the OS language, with English as fallback. */
const en = {
  shortcutUnavailable: 'Ctrl+Shift+E is unavailable. Check whether another app is using it; you can still open Companion from the tray.',
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', delete: 'Delete', selectAll: 'Select All',
  openApplication: 'Open DeepSeek Harness Companion',
  activityUnknown: 'Waiting for session status',
  activityRunning: 'Replying ({count})',
  activityIdle: 'Idle',
  trayUnavailable: 'The tray is unavailable. The window will stay accessible; closing it will exit Companion.',
  notificationUnavailable: 'The system notification could not be shown. Check system notification settings.',
  observerUnavailable: 'Completion observation is unavailable. Reopen the remote window; browsing can continue.',
  observerPaused: 'Completion observation is paused while Developer Tools is open. Close the tools and reload the remote page to resume.',
  observerReloadRequired: 'Reload the remote page to restore completion observation after closing Developer Tools.',
  replyCompleted: 'AI response completed',
  replyFailed: 'The AI turn failed. Open Companion to review the error.',
  turnEnded: 'This session turn ended. Open Companion to view the result.',
  language: 'en',
  title: 'Connect to DeepSeek Harness Companion',
  address: 'Server address or pairing link',
  hint: 'Tasks run on your remote server. Pair in this window on first use.',
  connect: 'Connect',
  invalid: 'Enter an HTTP or HTTPS address without a username or password.',
  failed: 'The remote page could not be opened. Check the server address and network, then retry.',
  retry: 'Retry',
  change: 'Change server…',
  quit: 'Quit',
  settingsFailed: 'The server address could not be read or saved. You may need to enter it again next time.',
}

/** Complete copy passed to the credential-free address form and native dialogs. */
export type CompanionMessages = typeof en

const zh: CompanionMessages = {
  shortcutUnavailable: '无法注册 Ctrl+Shift+E，请检查是否被其他应用占用；仍可通过托盘打开 Companion。',
  undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', delete: '删除', selectAll: '全选',
  openApplication: '打开 DeepSeek Harness Companion',
  activityUnknown: '等待会话状态',
  activityRunning: '正在回复（{count}）',
  activityIdle: '空闲',
  trayUnavailable: '托盘不可用，窗口仍可访问；关闭窗口将退出 Companion。',
  notificationUnavailable: '无法显示系统通知，请检查系统通知设置。',
  observerUnavailable: '无法监听回复结束事件，请重新打开远程窗口；浏览功能仍可使用。',
  observerPaused: '开发者工具打开期间暂停监听回复结束事件，请关闭开发者工具后刷新远程页面以恢复。',
  observerReloadRequired: '开发者工具已关闭，请刷新远程页面以恢复回复通知。',
  replyCompleted: 'AI 回复已完成',
  replyFailed: '本轮 AI 运行失败，请打开 Companion 查看错误。',
  turnEnded: '本轮会话运行已结束，请打开 Companion 查看结果。',
  language: 'zh-CN',
  title: '连接 DeepSeek Harness Companion',
  address: '服务器地址或配对链接',
  hint: '任务在远程服务器上运行，首次使用请在此窗口内完成配对。',
  connect: '连接',
  invalid: '请输入 HTTP 或 HTTPS 地址，地址中不能包含用户名或密码。',
  failed: '无法打开远程页面，请检查服务器地址和网络后重试。',
  retry: '重试',
  change: '更换服务器…',
  quit: '退出',
  settingsFailed: '无法读取或保存服务器地址，下次启动时可能需要重新输入。',
}

/**
 * Resolve the Companion's shipped English and Chinese copy.
 * @param language - Electron OS locale.
 * @returns Chinese copy for zh locales, English otherwise.
 */
export function companionMessages(language: string): CompanionMessages {
  return language.toLowerCase().split('-')[0] === 'zh' ? zh : en
}
