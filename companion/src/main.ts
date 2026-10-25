/** Independent remote-client entry; no desktop Host, official update feed or dsh protocol registration. */
import { app, dialog, type BrowserWindow } from 'electron'
import { COMPANION_NAME, initializeCompanionIdentity } from './identity.ts'
import { companionMessages } from './locale.ts'
import { openRemoteWindow, promptRemoteAddress, savedRemoteOrigin } from './connection-window.ts'

const userData = initializeCompanionIdentity(app)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let window: BrowserWindow | undefined
  const ownWindow = (next: BrowserWindow): void => {
    window = next
    next.setTitle(COMPANION_NAME)
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
  }
  app.on('second-instance', focus)
  app.on('activate', focus)
  void app.whenReady().then(async () => {
    const messages = companionMessages(app.getLocale())
    let url: string | undefined
    try { url = await savedRemoteOrigin(userData) } catch (_error) {
      dialog.showErrorBox(COMPANION_NAME, messages.settingsFailed)
    }
    for (;;) {
      url ??= await promptRemoteAddress(messages, userData, ownWindow)
      if (url === undefined || await openRemoteWindow(url, messages, ownWindow) === 'quit') { app.quit(); return }
      url = undefined
    }
  }).catch(() => {
    dialog.showErrorBox(COMPANION_NAME, companionMessages(app.getLocale()).failed)
    app.quit()
  })
}
