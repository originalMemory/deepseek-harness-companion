import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { companionMessages } from '../src/locale.ts'
import { installWindowChrome, remoteWindowChrome } from '../src/window-chrome.ts'

const native = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
  items: [] as MenuItemConstructorOptions[],
}))
vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false },
  ipcMain: Object.assign(new EventEmitter(), {
    handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => { native.handlers.set(name, handler) },
    removeHandler: (name: string) => { native.handlers.delete(name) },
  }),
  Menu: {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: (items: MenuItemConstructorOptions[]) => {
      native.items = items
      return { popup: ({ callback }: { callback?: () => void }) => { callback?.() } }
    },
  },
  BrowserWindow: class extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: 'https://nas.example.com/remote/' }, getZoomFactor: () => 1,
      send: vi.fn(), sendInputEvent: vi.fn(),
    })
    isDestroyed = () => false
    isFullScreen = () => false
    setTitleBarOverlay = vi.fn()
  },
}))
afterEach(() => { ipcMain.removeAllListeners(); native.handlers.clear() })

it('uses the official native caption geometry and rejects unowned frames before opening menus', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  try {
    expect(remoteWindowChrome()).toMatchObject({ titleBarStyle: 'hidden', titleBarOverlay: { height: 40 } })
    const window = new BrowserWindow()
    const change = vi.fn()
    const wallpaper = vi.fn()
    installWindowChrome(window, 'https://nas.example.com', companionMessages('en'), change, wallpaper)
    window.webContents.emit('context-menu')
    expect(native.items.slice(0, 2).map(item => item.label)).toEqual(['Change server…', '背景轮播…'])
    ;(native.items[1]!.click as () => void)()
    expect(wallpaper).toHaveBeenCalledOnce()
    const handler = native.handlers.get('dsh-desktop:windows-menu')!
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as IpcMainInvokeEvent
    for (const invalid of [
      { ...event, senderFrame: { url: 'https://nas.example.com/' } },
      { ...event, sender: {} },
    ]) expect(() => handler(invalid as IpcMainInvokeEvent, 'application', 0, 40)).toThrow('rejected')
    expect(() => handler(event, 'application', NaN, 40)).toThrow('rejected')
    expect(() => handler(event, 'application', -1, 40)).toThrow('rejected')
    const frameUrl = vi.spyOn(window.webContents.mainFrame, 'url', 'get').mockReturnValue('https://attacker.example.com/')
    expect(() => handler(event, 'application', 0, 40)).toThrow('rejected')
    frameUrl.mockReturnValue('https://nas.example.com/')
    await handler(event, 'application', 0, 40)
    const action = native.items[0]!.click as () => void
    action()
    expect(change).toHaveBeenCalledOnce()
    ipcMain.emit('dsh-desktop:windows-appearance', event, 'en', 'rgba(249, 250, 251, 1)', '#0f1115')
    expect(window.setTitleBarOverlay).toHaveBeenCalledOnce()
    ipcMain.emit('dsh-desktop:windows-appearance', event, 'en', 'invalid', '#0f1115')
    expect(window.setTitleBarOverlay).toHaveBeenCalledOnce()
    window.emit('closed')
    expect(native.handlers.size).toBe(0)
    expect(ipcMain.listenerCount('dsh-desktop:windows-appearance')).toBe(0)
  } finally { vi.restoreAllMocks() }
})


it('uses the embedded macOS caption geometry', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  try {
    const chrome = remoteWindowChrome()
    expect(chrome.titleBarStyle).toBe('hiddenInset')
    expect(chrome.trafficLightPosition).toEqual({ x: 16, y: 18 })
    expect(chrome.titleBarOverlay).toBeUndefined()
  } finally { vi.restoreAllMocks() }
})
