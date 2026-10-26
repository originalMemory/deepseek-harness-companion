import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, Rectangle } from 'electron'

const geometry = vi.hoisted(() => ({ load: vi.fn<() => Rectangle | undefined>(() => undefined), remember: vi.fn() }))
const trayDispose = vi.hoisted(() => vi.fn())
vi.mock('../src/window-chrome.ts', () => ({ hideCompanionWindow: (window: BrowserWindow) => { window.hide() } }))
vi.mock('../src/tray.ts', () => ({ CompanionTray: class { dispose = trayDispose; setRunning = vi.fn(); available = true } }))

const state = vi.hoisted(() => ({
  identity: vi.fn(() => '/companion-data'), saved: vi.fn<() => Promise<string | undefined>>(),
  prompt: vi.fn<() => Promise<string | undefined>>(),
  remote: vi.fn<(url: string, messages: unknown, own: (window: BrowserWindow) => void) => Promise<'change' | 'quit'>>(),
  quit: vi.fn(), on: vi.fn(), lock: vi.fn(() => true), error: vi.fn(),
  register: vi.fn<(_accelerator: string, _callback: () => void) => boolean>(() => true), unregister: vi.fn(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { requestSingleInstanceLock: state.lock, quit: state.quit, on: state.on, whenReady: async () => {}, getLocale: () => 'zh-CN' },
    dialog: { showErrorBox: state.error },
    globalShortcut: { register: state.register, unregisterAll: state.unregister },
    BrowserWindow: class extends EventEmitter {
      setTitle = vi.fn()
      isDestroyed = () => false
      isMinimized = () => true
      isVisible = vi.fn(() => true)
      isFocused = vi.fn(() => true)
      hide = vi.fn()
      restore = vi.fn()
      show = vi.fn()
      focus = vi.fn()
      webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
    },
  }
})
vi.mock('../src/identity.ts', () => ({
  COMPANION_NAME: 'DeepSeek Harness Companion', initializeCompanionIdentity: state.identity,
}))
vi.mock('../src/window-state.ts', () => ({ loadWindowBounds: geometry.load, rememberWindowBounds: geometry.remember }))
vi.mock('../src/connection-window.ts', () => ({
  savedRemoteOrigin: state.saved, promptRemoteAddress: state.prompt, openRemoteWindow: state.remote,
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  geometry.load.mockReset().mockReturnValue(undefined)
  state.saved.mockReset().mockResolvedValue('https://nas.example.com')
  state.prompt.mockReset().mockResolvedValue(undefined)
  state.remote.mockReset().mockResolvedValue('quit')
  state.lock.mockReturnValue(true)
  state.register.mockReturnValue(true)
})

it('opens the remembered server immediately without a local-or-remote choice', async () => {
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  expect(state.remote).toHaveBeenCalledWith('https://nas.example.com', expect.anything(), expect.any(Function),
    process.platform === 'win32' || process.platform === 'darwin' ? expect.anything() : undefined, undefined)
  expect(state.prompt).not.toHaveBeenCalled()
  expect(state.identity.mock.invocationCallOrder[0]).toBeLessThan(state.lock.mock.invocationCallOrder[0]!)
})

it('requests a server on first use and reopens the address form after changing server', async () => {
  state.saved.mockResolvedValueOnce(undefined)
  state.prompt.mockResolvedValueOnce('https://first.example.com').mockResolvedValueOnce('https://second.example.com')
  state.remote.mockResolvedValueOnce('change')
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.quit).toHaveBeenCalledOnce() })
  expect(state.remote.mock.calls.map(call => call[0])).toEqual(['https://first.example.com', 'https://second.example.com'])
  expect(state.prompt).toHaveBeenCalledTimes(2)
})

it('focuses only its own window and keeps Companion in page titles', async () => {
  const { BrowserWindow: TestWindow } = await import('electron')
  const window = new TestWindow()
  state.remote.mockImplementationOnce(async (_url, _messages, own) => { own(window); return 'quit' })
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  const focus = state.on.mock.calls.find(call => call[0] === 'second-instance')![1] as () => void
  focus()
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.focus).toHaveBeenCalledOnce()
  expect(window.webContents.send).toHaveBeenCalledWith('companion:focus-composer')
  const event = { preventDefault: vi.fn() }
  window.webContents.emit('page-title-updated', event, 'My server')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(window.setTitle).toHaveBeenLastCalledWith('My server — DeepSeek Harness Companion')
})

it('does not open another window when the Companion instance already owns its lock', async () => {
  state.lock.mockReturnValue(false)
  await import('../src/main.ts')
  expect(state.quit).toHaveBeenCalledOnce()
  expect(state.remote).not.toHaveBeenCalled()
  expect(state.prompt).not.toHaveBeenCalled()
})

it('keeps the tray until quit commits and never reopens an address window while quitting', async () => {
  const result = Promise.withResolvers<'change' | 'quit'>()
  state.remote.mockReturnValueOnce(result.promise)
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  const beforeQuit = state.on.mock.calls.find(call => call[0] === 'before-quit')![1] as () => void
  const willQuit = state.on.mock.calls.find(call => call[0] === 'will-quit')![1] as () => void
  beforeQuit()
  expect(trayDispose).not.toHaveBeenCalled()
  result.resolve('change')
  await result.promise
  expect(state.prompt).not.toHaveBeenCalled()
  willQuit()
  expect(state.unregister).toHaveBeenCalledOnce()
  if (process.platform === 'win32' || process.platform === 'darwin') expect(trayDispose).toHaveBeenCalledOnce()
})

it('toggles the focused window and raises the retained conversation with composer focus', async () => {
  const { BrowserWindow: TestWindow } = await import('electron')
  const window = new TestWindow()
  const minimized = vi.spyOn(window, 'isMinimized').mockReturnValue(false)
  state.remote.mockImplementationOnce(async (_url, _messages, own) => { own(window); return 'quit' })
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  expect(state.register).toHaveBeenCalledWith('Control+Shift+E', expect.any(Function))
  const toggle = state.register.mock.calls[0]![1] as () => void
  toggle()
  expect(window.hide).toHaveBeenCalledOnce()
  expect(window.webContents.send).not.toHaveBeenCalled()
  vi.spyOn(window, 'isFocused').mockReturnValue(false)
  minimized.mockReturnValue(true)
  toggle()
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith('companion:focus-composer')
})

it('reports an occupied global shortcut while still opening the server', async () => {
  state.register.mockReturnValue(false)
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  expect(state.error).toHaveBeenCalledWith('DeepSeek Harness Companion', expect.stringContaining('Ctrl+Shift+E'))
})

it('restores and tracks bounds only for the remote application window', async () => {
  const bounds = { x: 120, y: 80, width: 900, height: 700 }
  geometry.load.mockReturnValue(bounds)
  const { BrowserWindow: TestWindow } = await import('electron')
  const window = new TestWindow()
  state.remote.mockImplementationOnce(async (_url, _messages, own) => { own(window); return 'quit' })
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  expect(state.remote).toHaveBeenCalledWith('https://nas.example.com', expect.anything(), expect.any(Function),
    process.platform === 'win32' || process.platform === 'darwin' ? expect.anything() : undefined, bounds)
  expect(geometry.load).toHaveBeenCalledWith('/companion-data', expect.anything())
  expect(geometry.remember).toHaveBeenCalledWith(window, '/companion-data', expect.anything())
})
