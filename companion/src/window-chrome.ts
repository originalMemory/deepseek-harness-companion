/** Official caption presentation with only same-origin appearance and menu IPC. */
import { fileURLToPath } from 'node:url'
import { ipcMain, Menu, nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions } from 'electron'
import { COMPANION_NAME } from './identity.ts'
import type { CompanionMessages } from './locale.ts'

const appearanceChannel = 'dsh-desktop:windows-appearance'
const menuChannel = 'dsh-desktop:windows-menu'
const fullscreenChannel = 'dsh-desktop:window-fullscreen'
const fallbackFill = (): string => nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb'

/**
 * Resolve the official primary-window caption options for this OS.
 * @returns Native caption settings for the current OS.
 */
export function remoteWindowChrome(): BrowserWindowConstructorOptions {
  return {
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { height: 40, color: fallbackFill(), symbolColor: nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115' },
    } : {}),
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 },
      vibrancy: 'sidebar' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000',
    } : {}),
  }
}

/** Absolute path to the sandbox-compatible CommonJS caption preload. */
export const captionPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))

/**
 * Attach official caption/menu interactions without the official Host bridge.
 * @param window - Remote window owning all registered listeners.
 * @param origin - Only selected-origin main-frame messages are accepted.
 * @param messages - Companion recovery and quit labels.
 * @param change - Replace the current server window.
 */
export function installWindowChrome(window: BrowserWindow, origin: string, messages: CompanionMessages, change: () => void): void {
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame !== null && new URL(event.senderFrame.url).origin === origin
  const applicationItems = (): MenuItemConstructorOptions[] => [
    ...(process.platform === 'darwin' ? [{ role: 'about' as const }, { type: 'separator' as const }] : []),
    { label: messages.change, click: change },
    { type: 'separator' },
    ...(process.platform === 'darwin' ? [{ role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }] : []),
    { label: messages.quit, role: 'quit' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(process.platform === 'win32' ? [
    { role: 'toggleDevTools', visible: false }, { role: 'toggleDevTools', visible: false, accelerator: 'F12' },
  ] : [
    { label: COMPANION_NAME, submenu: applicationItems() },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
  // Recovery stays available before the remote application mounts its caption menu.
  window.webContents.on('context-menu', () => {
    Menu.buildFromTemplate(applicationItems()).popup({ window })
  })
  const appearance = (event: Electron.IpcMainEvent, _locale: unknown, color: unknown, symbolColor: unknown): void => {
    if (!trusted(event)) return
    const validColor = (value: unknown): value is string => typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
    if (validColor(color) && validColor(symbolColor)) window.setTitleBarOverlay({ color, symbolColor })
  }
  if (process.platform === 'win32') {
    ipcMain.on(appearanceChannel, appearance)
    ipcMain.handle(menuChannel, (event, name: unknown, x: unknown, y: unknown) => {
      if (!trusted(event) || (name !== 'application' && name !== 'edit') || typeof x !== 'number' || typeof y !== 'number'
        || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 100_000 || y > 100_000) throw new Error('Companion: rejected caption menu request')
      const edit = (label: string, keyCode: string, control = true): MenuItemConstructorOptions => ({ label, click: () => {
        const modifiers: Array<'control'> = control ? ['control'] : []
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
      } })
      const items: MenuItemConstructorOptions[] = name === 'application' ? applicationItems() : [
        edit(messages.undo, 'Z'), edit(messages.redo, 'Y'), { type: 'separator' },
        edit(messages.cut, 'X'), edit(messages.copy, 'C'), edit(messages.paste, 'V'),
        edit(messages.delete, 'Delete', false), { type: 'separator' }, edit(messages.selectAll, 'A'),
      ]
      const zoom = window.webContents.getZoomFactor()
      return new Promise<void>(resolve => { Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve }) })
    })
  }
  const fullscreen = (): void => { if (!window.isDestroyed()) window.webContents.send(fullscreenChannel, window.isFullScreen()) }
  window.on('enter-full-screen', fullscreen)
  window.on('leave-full-screen', fullscreen)
  window.webContents.on('did-finish-load', fullscreen)
  if (process.platform === 'darwin') {
    const backdrop = (): void => {
      if (window.isDestroyed()) return
      const hidden = window.isMinimized() || !window.isVisible()
      window.setVibrancy(hidden ? null : 'sidebar')
      window.setBackgroundColor(hidden ? fallbackFill() : '#00000000')
    }
    window.on('minimize', backdrop)
    window.on('hide', backdrop)
    window.on('restore', backdrop)
    window.on('show', backdrop)
  }
  window.once('closed', () => {
    if (process.platform === 'win32') { ipcMain.removeListener(appearanceChannel, appearance); ipcMain.removeHandler(menuChannel) }
    Menu.setApplicationMenu(null)
  })
}

/**
 * Hide a window, leaving macOS fullscreen before removing its visible window.
 * @param window - Existing Companion window.
 */
export function hideCompanionWindow(window: BrowserWindow): void {
  if (process.platform === 'darwin' && window.isFullScreen()) {
    window.once('leave-full-screen', () => { if (!window.isDestroyed()) window.hide() })
    window.setFullScreen(false)
  } else window.hide()
}
