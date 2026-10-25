/** Remote-client copy follows the OS language, with English as fallback. */
const en = {
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
