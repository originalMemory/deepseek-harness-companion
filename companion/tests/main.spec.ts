import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const state = vi.hoisted(() => ({
  identity: vi.fn(() => '/companion-data'), saved: vi.fn<() => Promise<string | undefined>>(),
  prompt: vi.fn<() => Promise<string | undefined>>(),
  remote: vi.fn<(url: string, messages: unknown, own: (window: BrowserWindow) => void) => Promise<'change' | 'quit'>>(),
  quit: vi.fn(), on: vi.fn(), lock: vi.fn(() => true), error: vi.fn(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { requestSingleInstanceLock: state.lock, quit: state.quit, on: state.on, whenReady: async () => {}, getLocale: () => 'zh-CN' },
    dialog: { showErrorBox: state.error },
    BrowserWindow: class extends EventEmitter {
      setTitle = vi.fn()
      isDestroyed = () => false
      isMinimized = () => true
      restore = vi.fn()
      show = vi.fn()
      focus = vi.fn()
      webContents = new EventEmitter()
    },
  }
})
vi.mock('../src/identity.ts', () => ({
  COMPANION_NAME: 'DeepSeek Harness Companion', initializeCompanionIdentity: state.identity,
}))
vi.mock('../src/connection-window.ts', () => ({
  savedRemoteOrigin: state.saved, promptRemoteAddress: state.prompt, openRemoteWindow: state.remote,
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  state.saved.mockReset().mockResolvedValue('https://nas.example.com')
  state.prompt.mockReset().mockResolvedValue(undefined)
  state.remote.mockReset().mockResolvedValue('quit')
  state.lock.mockReturnValue(true)
})

it('opens the remembered server immediately without a local-or-remote choice', async () => {
  await import('../src/main.ts')
  await vi.waitFor(() => { expect(state.remote).toHaveBeenCalledOnce() })
  expect(state.remote).toHaveBeenCalledWith('https://nas.example.com', expect.anything(), expect.any(Function))
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
