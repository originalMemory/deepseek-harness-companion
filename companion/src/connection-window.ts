/** Remote-only address entry and sandboxed Web windows; no Harness Host is imported. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, dialog, session, shell, type Rectangle } from 'electron'
import { COMPANION_NAME } from './identity.ts'
import type { CompanionMessages } from './locale.ts'
import { CompletionNotifications } from './completion-notifications.ts'
import type { CompanionTray } from './tray.ts'
import { captionPreload, hideCompanionWindow, installWindowChrome, remoteWindowChrome } from './window-chrome.ts'

const SELECT = 'https://dsh-companion.invalid/connect'

/**
 * Validate an operator-supplied Web address without accepting embedded credentials.
 * @param value - Server address or first-use pairing link.
 * @returns Normalized HTTP(S) URL, or undefined for invalid input.
 */
export function remoteUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') return undefined
    return url.href
  } catch (_error) {
    // Invalid operator input remains in the address form.
    return undefined
  }
}

/**
 * Read only the remembered origin; pairing paths and tokens are never reused at startup.
 * @param userData - Companion-owned preference directory.
 * @returns Saved origin, or undefined on first use; invalid or unreadable files reject.
 */
export async function savedRemoteOrigin(userData: string): Promise<string | undefined> {
  let value: string
  try { value = await readFile(join(userData, 'remote-url.txt'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const url = remoteUrl(value)
  if (url === undefined) throw new Error('Invalid saved Companion server address')
  return new URL(url).origin
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * Ask for a server only on first use or after the operator chooses to change it.
 * @param messages - Localized shell copy.
 * @param userData - Companion-owned directory; a save failure is reported before continuing.
 * @param ownWindow - Registers the window for process activation and identity.
 * @returns Selected URL, or undefined on close; document load failures destroy the window and reject.
 */
export async function promptRemoteAddress(
  messages: CompanionMessages, userData: string, ownWindow: (window: BrowserWindow) => void,
): Promise<string | undefined> {
  let remembered = ''
  try { remembered = await savedRemoteOrigin(userData) ?? '' } catch (_error) {
    dialog.showErrorBox(COMPANION_NAME, messages.settingsFailed)
  }
  const window = new BrowserWindow({
    width: 560, height: 400, minWidth: 420, minHeight: 360, show: false, title: COMPANION_NAME,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  ownWindow(window)
  window.setMenu(null)
  // ponytail: a native form submits through intercepted navigation, without a preload or renderer script.
  const html = `<!doctype html><html lang="${messages.language}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action ${SELECT}">
<title>${COMPANION_NAME}</title>
<style>:root{color-scheme:light dark;font:14px system-ui}body{margin:28px}h1{font-size:22px;font-weight:500}p{line-height:1.6}form,label{display:grid;gap:14px}input,button{font:inherit;padding:10px;border:1px solid GrayText;border-radius:6px}input{min-width:0}button{cursor:pointer}</style>
</head><body><h1>${escapeHtml(messages.title)}</h1><p>${escapeHtml(messages.hint)}</p>
<form action="${SELECT}" method="get"><label>${escapeHtml(messages.address)}
<input name="url" type="url" required value="${escapeHtml(remembered)}" placeholder="https://nas.example.com" autocomplete="off"></label>
<button>${escapeHtml(messages.connect)}</button></form></body></html>\n`
  const page = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  const selection = Promise.withResolvers<string | undefined>()
  let submitted = false
  window.once('closed', () => { selection.resolve(undefined) })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, destination) => {
    event.preventDefault()
    if (submitted || window.webContents.getURL() !== page) return
    const request = new URL(destination)
    if (request.origin + request.pathname !== SELECT) return
    const url = remoteUrl(request.searchParams.get('url') ?? '')
    if (url === undefined) { dialog.showErrorBox(COMPANION_NAME, messages.invalid); return }
    submitted = true
    void writeFile(join(userData, 'remote-url.txt'), `${new URL(url).origin}\n`, { mode: 0o600 })
      .catch(() => { if (!window.isDestroyed()) dialog.showErrorBox(COMPANION_NAME, messages.settingsFailed) })
      .then(() => {
        if (window.isDestroyed()) return
        selection.resolve(url)
        window.close()
      })
  })
  try {
    await window.loadURL(page)
    if (!window.isDestroyed()) window.show()
  } catch (error) {
    if (window.isDestroyed()) return undefined
    window.destroy()
    throw error
  }
  return selection.promise
}

/**
 * Open remote Web content with separate persistent cookies and isolated caption IPC.
 * @param url - Validated HTTP(S) address, including a first-use pairing link.
 * @param messages - Localized shell copy.
 * @param ownWindow - Registers the window for process activation and identity.
 * @param tray - Available application tray; omission preserves close-to-quit behavior.
 * @param bounds - Saved normal bounds; omission uses the default size and OS placement.
 * @returns Whether to change server or quit; ordinary close hides to an available tray without stopping observation.
 */
export function openRemoteWindow(
  url: string, messages: CompanionMessages, ownWindow: (window: BrowserWindow) => void,
  tray?: Pick<CompanionTray, 'available' | 'setRunning'>, bounds?: Rectangle,
): Promise<'change' | 'quit'> {
  const origin = new URL(url).origin
  const storage = session.fromPartition('persist:companion')
  const window = new BrowserWindow({
    width: 1280, height: 820, ...bounds, minWidth: 520, minHeight: 600, title: COMPANION_NAME,
    ...remoteWindowChrome(),
    webPreferences: { preload: captionPreload, session: storage, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  const selectedOrigin = (value: string): boolean => {
    try { return new URL(value).origin === origin } catch (_error) { return false /* Provisional frames may have no URL. */ }
  }
  storage.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(!window.isDestroyed() && contents === window.webContents && permission === 'clipboard-sanitized-write'
      && details.isMainFrame && selectedOrigin(details.requestingUrl))
  })
  storage.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    !window.isDestroyed() && contents === window.webContents && permission === 'clipboard-sanitized-write'
    && details.isMainFrame && selectedOrigin(requestingOrigin))
  ownWindow(window)
  return new Promise((resolve) => {
    let outcome: 'change' | 'quit' = 'quit'
    let forceClose = false
    let reporting = false
    const change = (): void => { forceClose = true; outcome = 'change'; window.close() }
    window.on('close', (event) => {
      if (!forceClose && tray?.available) { event.preventDefault(); hideCompanionWindow(window) }
    })
    const notifications = new CompletionNotifications(window, origin, messages, count => { tray?.setRunning(count) })
    window.once('closed', () => {
      notifications.dispose()
      storage.flushStorageData()
      resolve(outcome)
    })
    installWindowChrome(window, origin, messages, change)
    const failed = async (): Promise<void> => {
      if (reporting || window.isDestroyed()) return
      reporting = true
      try {
        const result = await dialog.showMessageBox(window, {
          type: 'error', title: COMPANION_NAME, message: messages.failed,
          buttons: [messages.retry, messages.change, messages.quit], cancelId: 2,
        })
        if (window.isDestroyed()) return
        if (result.response === 0) {
          reporting = false
          const current = remoteUrl(window.webContents.getURL())
          load(current !== undefined && new URL(current).origin === origin ? current : url)
        } else if (result.response === 1) change()
        else { forceClose = true; window.close() }
      } catch (_error) {
        // A failed native dialog must not leave a remote window without a recovery action.
        if (!window.isDestroyed()) { dialog.showErrorBox(COMPANION_NAME, messages.failed); change() }
      } finally { reporting = false }
    }
    const load = (target: string): void => {
      // Network.enable needs a renderer target before the remote page opens its first socket.
      void window.loadURL('about:blank').then(() => notifications.ready).then(() => {
        if (!window.isDestroyed()) return window.loadURL(target)
      }).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED') return
        void failed()
      })
    }
    const fence = (event: Electron.Event, target: string): void => {
      if (new URL(target).origin !== origin) { event.preventDefault(); void failed() }
    }
    window.webContents.on('will-navigate', fence)
    window.webContents.on('will-redirect', (event, target, _inPage, isMainFrame) => {
      if (isMainFrame) fence(event, target)
    })
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      const external = remoteUrl(target)
      if (external !== undefined) {
        if (new URL(external).origin === origin) load(external)
        else void shell.openExternal(external).catch(() => {
          if (!window.isDestroyed()) dialog.showErrorBox(COMPANION_NAME, messages.failed)
        })
      }
      return { action: 'deny' }
    })
    window.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) void failed()
    })
    window.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') void failed() })
    load(url)
  })
}
