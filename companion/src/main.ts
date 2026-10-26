/** Independent remote-client entry; no desktop Host, official update feed or dsh protocol registration. */
import { app, dialog, globalShortcut, type BrowserWindow } from 'electron'
import { COMPANION_NAME, initializeCompanionIdentity } from './identity.ts'
import { companionMessages } from './locale.ts'
import { openRemoteWindow, promptRemoteAddress, savedRemoteOrigin } from './connection-window.ts'
import { loadWindowBounds, rememberWindowBounds } from './window-state.ts'
import { CompanionTray } from './tray.ts'
import { hideCompanionWindow } from './window-chrome.ts'

const userData = initializeCompanionIdentity(app)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let window: BrowserWindow | undefined
  let tray: CompanionTray | undefined
  let quitting = false
  const ownWindow = (next: BrowserWindow): void => {
    window = next
    next.setTitle(COMPANION_NAME)
    next.webContents.on('will-prevent-unload', () => { quitting = false })
    next.webContents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      next.setTitle(title.endsWith(COMPANION_NAME) ? title : `${title} — ${COMPANION_NAME}`)
    })
  }
  const focus = (): void => {
    if (window === undefined || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('companion:focus-composer')
  }
  app.on('second-instance', focus)
  app.on('activate', focus)
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.dispose() })
  // Window replacement may leave no windows briefly; the launch loop and explicit Quit own termination.
  app.on('window-all-closed', () => {})
  void app.whenReady().then(async () => {
    if (quitting) return
    const messages = companionMessages(app.getLocale())
    const toggle = (): void => {
      if (window === undefined || window.isDestroyed()) return
      if (window.isVisible() && window.isFocused() && !window.isMinimized()) hideCompanionWindow(window)
      else focus()
    }
    try {
      if (!globalShortcut.register('Control+Shift+E', toggle)) throw new Error('Shortcut unavailable')
    } catch (_error) {
      dialog.showErrorBox(COMPANION_NAME, messages.shortcutUnavailable)
    }
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try { tray = new CompanionTray(messages, focus, () => { app.quit() }, process.platform, () => quitting) } catch (_error) {
        console.warn(messages.trayUnavailable)
        dialog.showErrorBox(COMPANION_NAME, messages.trayUnavailable)
      }
    }
    let url: string | undefined
    try { url = await savedRemoteOrigin(userData) } catch (_error) {
      dialog.showErrorBox(COMPANION_NAME, messages.settingsFailed)
    }
    for (;;) {
      if (quitting) return
      url ??= await promptRemoteAddress(messages, userData, ownWindow)
      if (quitting) return
      if (url === undefined || await openRemoteWindow(url, messages, next => {
        ownWindow(next)
        rememberWindowBounds(next, userData, messages)
      }, tray, loadWindowBounds(userData, messages)) === 'quit') { app.quit(); return }
      url = undefined
    }
  }).catch(() => {
    dialog.showErrorBox(COMPANION_NAME, companionMessages(app.getLocale()).failed)
    app.quit()
  })
}
