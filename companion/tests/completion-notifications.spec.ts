import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { BrowserWindow, type Notification } from 'electron'
import { CompletionNotifications } from '../src/completion-notifications.ts'
import { companionMessages } from '../src/locale.ts'

const native = vi.hoisted(() => ({
  toasts: [] as unknown[], supported: true, focused: false, devtools: false, attached: false,
  error: vi.fn(), command: vi.fn<(method: string) => Promise<void>>(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    dialog: { showErrorBox: native.error },
    Notification: class extends EventEmitter {
      static isSupported() { return native.supported }
      title: string
      body: string
      constructor(options: { title: string; body: string }) {
        super(); this.title = options.title; this.body = options.body; native.toasts.push(this)
      }
      show = vi.fn()
      close = vi.fn()
    },
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        isDevToolsOpened: () => native.devtools,
        debugger: Object.assign(new EventEmitter(), {
          isAttached: () => native.attached,
          attach: vi.fn(() => { native.attached = true }),
          detach: vi.fn(() => { native.attached = false }),
          sendCommand: native.command,
        }),
      })
      isDestroyed = () => false
      isFocused = () => native.focused
      isVisible = () => true
      isMinimized = () => true
      restore = vi.fn()
      show = vi.fn()
      focus = vi.fn()
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  native.toasts.length = 0
  native.focused = false; native.devtools = false; native.attached = false; native.supported = true
  native.command.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

function setup(language = 'en') {
  const window = new BrowserWindow()
  const messages = companionMessages(language)
  const unread = vi.fn()
  const notifications = new CompletionNotifications(window, 'https://nas.example.com', messages, () => {}, unread)
  const cdp = (method: string, value: unknown) => { window.webContents.debugger.emit('message', {}, method, value) }
  const frame = (direction: 'Sent' | 'Received', message: unknown) => {
    cdp(`Network.webSocketFrame${direction}`, { requestId: 'socket', response: { opcode: 1, payloadData: JSON.stringify(message) } })
  }
  const start = () => {
    cdp('Network.webSocketCreated', { requestId: 'socket', url: 'wss://nas.example.com/remote/api/remote.mux' })
    frame('Sent', { type: 'open', streamId: 'follow', endpoint: 'session/follow', payload: { args: {
      request: { address: { kind: 'session', sessionId: 's' } },
    } } })
  }
  const event = (type: string, data: unknown) => { frame('Received', {
    type: 'item', streamId: 'follow', value: { type: 'event', event: { type, data } },
  }) }
  const finish = (turn: number, kind = 'completed') => {
    start()
    event('turn/start', { turn })
    event('turn/end', { turn, reason: { kind } })
  }
  return { window, notifications, cdp, event, finish, start, messages, unread, toasts: native.toasts as Notification[] }
}

it('enables observation before navigation and coalesces concurrent readiness waits', async () => {
  const pending = Promise.withResolvers<void>()
  native.command.mockReturnValueOnce(pending.promise)
  const s = setup()
  const first = s.notifications.ready
  const second = s.notifications.ready
  expect(first).toBe(second)
  expect(native.command).toHaveBeenCalledExactlyOnceWith('Network.enable')
  pending.resolve()
  await first
  s.notifications.dispose()
})

it('shows a background native notification once and focuses the window when clicked', async () => {
  const s = setup()
  await s.notifications.ready
  s.finish(1)
  s.event('turn/end', { turn: 1, reason: { kind: 'completed' } })
  expect(s.unread).toHaveBeenCalledOnce()
  expect(s.toasts).toHaveLength(1)
  expect(s.toasts[0]!.body).toBe(s.messages.replyCompleted)
  expect(s.toasts[0]!.show).toHaveBeenCalledOnce()
  s.toasts[0]!.emit('click')
  expect(s.window.restore).toHaveBeenCalledOnce()
  expect(s.window.focus).toHaveBeenCalledOnce()
  s.notifications.dispose()
})

it('suppresses focused-window reminders and known cancellation', async () => {
  const s = setup()
  await s.notifications.ready
  native.focused = true
  s.finish(1)
  native.focused = false
  s.finish(2, 'aborted')
  expect(s.toasts).toHaveLength(0)
  expect(s.unread).not.toHaveBeenCalled()
  s.notifications.dispose()
})

it('reports native notification failure once without making the turn successful', async () => {
  const s = setup()
  await s.notifications.ready
  s.finish(1, 'error')
  expect(s.toasts[0]!.body).toBe(s.messages.replyFailed)
  s.toasts[0]!.emit('failed', {}, 'not logged')
  native.supported = false
  s.finish(2)
  expect(native.error).toHaveBeenCalledTimes(1)
  expect(s.unread).toHaveBeenCalledTimes(2)
  s.notifications.dispose()
})

it('reports observer setup failure but allows the remote page to load', async () => {
  native.command.mockRejectedValueOnce(new Error('sensitive URL must not be logged'))
  const s = setup()
  await expect(s.notifications.ready).resolves.toBeUndefined()
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', s.messages.observerUnavailable)
  expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('sensitive'))
  s.notifications.dispose()
})

it('requests a page reload after Developer Tools closes and removes owned listeners on disposal', async () => {
  const s = setup()
  await s.notifications.ready
  native.devtools = true; native.attached = false
  s.window.webContents.debugger.emit('detach', {}, 'replaced_with_devtools')
  expect(native.error).not.toHaveBeenCalled()
  native.devtools = false
  s.window.webContents.emit('devtools-closed')
  await s.notifications.ready
  expect(native.command).toHaveBeenCalledTimes(2)
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', s.messages.observerReloadRequired)
  s.finish(1)
  s.notifications.dispose()
  s.notifications.dispose()
  expect(s.toasts[0]!.close).toHaveBeenCalledOnce()
  expect(s.window.webContents.debugger.listenerCount('message')).toBe(0)
  expect(s.window.webContents.listenerCount('devtools-closed')).toBe(0)
  expect(s.window.webContents.debugger.detach).toHaveBeenCalledOnce()
})

it('treats ordinary close as teardown and never reads a destroyed window’s webContents getter', async () => {
  const s = setup()
  await s.notifications.ready
  const contents = s.window.webContents
  s.window.emit('close', {})
  contents.debugger.emit('detach', {}, 'Render process gone')
  expect(native.error).not.toHaveBeenCalled()
  vi.spyOn(contents, 'isDestroyed').mockReturnValue(true)
  Object.defineProperty(s.window, 'webContents', { get: () => { throw new Error('Object has been destroyed') } })
  expect(() => { s.notifications.dispose() }).not.toThrow()
  expect(contents.debugger.listenerCount('message')).toBe(0)
})

it('keeps observing after a tray handler prevents the window from closing', async () => {
  const s = setup()
  await s.notifications.ready
  s.window.emit('close', { defaultPrevented: true })
  native.command.mockRejectedValueOnce(new Error('observer unavailable'))
  await s.notifications.ready
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', s.messages.observerUnavailable)
  s.notifications.dispose()
})

it.each(['en', 'zh-CN'])('owns the native popup copy for %s', async (language) => {
  const s = setup(language)
  await s.notifications.ready
  s.finish(1)
  s.finish(2, 'error')
  s.finish(3, 'blocked')
  await expect(JSON.stringify(s.toasts.map(toast => ({ title: toast.title, body: toast.body })), null, 2) + '\n')
    .toMatchFileSnapshot(`./expected/completion-notifications-${language}.json`)
  s.notifications.dispose()
})
