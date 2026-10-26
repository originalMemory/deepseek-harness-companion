import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron'
import { promptRemoteAddress, remoteUrl, openRemoteWindow } from '../src/connection-window.ts'
import { companionMessages } from '../src/locale.ts'
import { COMPANION_NAME } from '../src/identity.ts'
import type { CompanionTray } from '../src/tray.ts'

const monitoring = vi.hoisted(() => ({ ready: vi.fn<() => Promise<void>>(async () => {}), dispose: vi.fn() }))
vi.mock('../src/window-chrome.ts', () => ({
  captionPreload: '/companion/preload.cjs', remoteWindowChrome: () => ({ titleBarStyle: 'hidden' }),
  hideCompanionWindow: (window: FakeWindow) => { window.hide() },
  installWindowChrome: (_window: FakeWindow, _origin: string, messages: { change: string; quit: string }, change: () => void) => {
    native.menu = [{ submenu: [{ label: messages.change, click: change }, { label: messages.quit, role: 'quit' }] }]
  },
}))
vi.mock('../src/completion-notifications.ts', () => ({
  CompletionNotifications: class {
    get ready() { return monitoring.ready() }
    dispose = monitoring.dispose
  },
}))

const native = vi.hoisted(() => ({
  create: vi.fn<(options: BrowserWindowConstructorOptions) => FakeWindow>(),
  error: vi.fn(), dialog: vi.fn(), external: vi.fn(async () => {}), menu: [] as MenuItemConstructorOptions[],
  storage: {
    setPermissionRequestHandler: vi.fn<(
      handler: (contents: unknown, permission: string, callback: (allow: boolean) => void, details: { isMainFrame: boolean; requestingUrl: string }) => void,
    ) => void>(),
    setPermissionCheckHandler: vi.fn<(handler: (contents: unknown, permission: string, origin: string, details: { isMainFrame: boolean }) => boolean) => void>(), flushStorageData: vi.fn(),
  },
  partition: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions) { return native.create(options) }),
  dialog: { showErrorBox: native.error, showMessageBox: native.dialog },
  shell: { openExternal: native.external },
  session: { fromPartition: (name: string) => { native.partition(name); return native.storage } },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => { native.menu = template; return template },
    setApplicationMenu: vi.fn(),
  },
}))

class FakeWindow extends EventEmitter {
  destroyed = false
  url = ''
  webContents = Object.assign(new EventEmitter(), {
    getURL: () => this.url,
    setWindowOpenHandler: vi.fn<(handler: (details: { url: string }) => { action: string }) => void>(),
  })
  show = vi.fn()
  setMenu = vi.fn()
  isDestroyed = () => this.destroyed
  close = (): void => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    this.emit('close', event)
    if (!event.defaultPrevented) this.destroy()
  }
  hide = vi.fn()
  destroy = (): void => { this.destroyed = true; this.emit('closed') }
  loadURL = vi.fn(async (url: string) => { this.url = url })
  navigate(url: string, eventName = 'will-navigate') {
    const event = { preventDefault: vi.fn() }
    if (eventName === 'will-redirect') this.webContents.emit(eventName, event, url, false, true)
    else this.webContents.emit(eventName, event, url)
    return event
  }
}

const locale = { messages: companionMessages('en') }
beforeEach(() => {
  vi.clearAllMocks()
  native.create.mockImplementation(() => new FakeWindow())
  native.dialog.mockReset().mockResolvedValue({ response: 2 })
})
afterEach(() => { vi.restoreAllMocks() })

async function fixture() {
  const userData = await mkdtemp(join(tmpdir(), 'dsh-connection-'))
  onTestFinished(async () => { await rm(userData, { recursive: true, force: true }) })
  const window = new FakeWindow()
  native.create.mockReturnValue(window)
  onTestFinished(() => { if (!window.destroyed) window.destroy() })
  return { userData, window, address: join(userData, 'remote-url.txt') }
}

it.each(['file:///tmp/a', 'javascript:alert(1)', 'ftp://nas', 'https://u:p@nas/', 'not a url', 'http://nas:99999'])('rejects a non-Web or credential-bearing address: %s', (value) => {
  expect(remoteUrl(value)).toBeUndefined()
})

it('accepts pairing query and fragment without changing them', () => {
  expect(remoteUrl(' https://nas.example.com/pair?token=once#pair ')).toBe('https://nas.example.com/pair?token=once#pair')
  expect(remoteUrl('http://192.168.1.2:8080')).toBe('http://192.168.1.2:8080/')
})

it.each(['en', 'zh-CN'])('presents a localized remote address form without a preload: %s', async (language) => {
  const { userData, window } = await fixture()
  const selection = promptRemoteAddress(companionMessages(language), userData, vi.fn())
  await vi.waitFor(() => { expect(window.show).toHaveBeenCalledOnce() })
  const html = decodeURIComponent(window.url.slice(window.url.indexOf(',') + 1))
  expect(html).not.toContain('value="local"')
  await expect(html).toMatchFileSnapshot(`./expected/connection-selector-${language}.html`)
  expect(native.create.mock.lastCall![0].webPreferences).toEqual({
    nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
  })
  expect(window.navigate('https://dsh-companion.invalid/connect?url=https://nas.example.com').preventDefault).toHaveBeenCalledOnce()
  expect(await selection).toBe('https://nas.example.com/')
})

it('remembers only the origin and reopens the selector without the pairing secret', async () => {
  const { userData, window, address } = await fixture()
  const selection = promptRemoteAddress(locale.messages, userData, vi.fn())
  await vi.waitFor(() => { expect(window.show).toHaveBeenCalledOnce() })
  const url = 'https://nas.example.com/pair-accept?token=one-use#private'
  window.navigate(`https://dsh-companion.invalid/connect?url=${encodeURIComponent(url)}`)
  expect(await selection).toBe(url)
  expect(await readFile(address, 'utf8')).toBe('https://nas.example.com\n')
  const next = new FakeWindow()
  native.create.mockReturnValue(next)
  const reopened = promptRemoteAddress(locale.messages, userData, vi.fn())
  await vi.waitFor(() => { expect(next.show).toHaveBeenCalledOnce() })
  const html = decodeURIComponent(next.url)
  expect(html).toContain('value="https://nas.example.com"')
  expect(html).not.toContain('one-use')
  next.close()
  expect(await reopened).toBeUndefined()
})

it('keeps invalid input in the selector and does not accept unrelated navigation', async () => {
  const { userData, window } = await fixture()
  const selection = promptRemoteAddress(locale.messages, userData, vi.fn())
  await vi.waitFor(() => { expect(window.show).toHaveBeenCalledOnce() })
  window.navigate('https://elsewhere.example.com/connect?mode=local')
  expect(window.destroyed).toBe(false)
  window.navigate('https://dsh-companion.invalid/connect?url=file:///tmp/a')
  expect(native.error).toHaveBeenCalledWith(COMPANION_NAME, locale.messages.invalid)
  window.close()
  expect(await selection).toBeUndefined()
})

it('reports unreadable preferences and lets the operator enter a server again', async () => {
  const { userData, window, address } = await fixture()
  await writeFile(address, 'not a url')
  const selection = promptRemoteAddress(locale.messages, userData, vi.fn())
  await vi.waitFor(() => { expect(window.show).toHaveBeenCalledOnce() })
  expect(native.error).toHaveBeenCalledWith(COMPANION_NAME, locale.messages.settingsFailed)
  window.navigate('https://dsh-companion.invalid/connect?url=https://nas.example.com')
  expect(await selection).toBe('https://nas.example.com/')
})

it('reports a preference write failure while continuing with the selected server', async () => {
  const { userData, window, address } = await fixture()
  await mkdir(address)
  const selection = promptRemoteAddress(locale.messages, userData, vi.fn())
  await vi.waitFor(() => { expect(window.show).toHaveBeenCalledOnce() })
  native.error.mockClear()
  window.navigate('https://dsh-companion.invalid/connect?url=https://nas.example.com')
  expect(await selection).toBe('https://nas.example.com/')
  expect(native.error).toHaveBeenCalledWith(COMPANION_NAME, locale.messages.settingsFailed)
})

it('destroys a selector whose document cannot load', async () => {
  const { userData, window } = await fixture()
  window.loadURL.mockRejectedValue(new Error('load failed'))
  await expect(promptRemoteAddress(locale.messages, userData, vi.fn())).rejects.toThrow('load failed')
  expect(window.destroyed).toBe(true)
})

it('treats a selector closed during loading as cancellation', async () => {
  const { userData, window } = await fixture()
  const loading = Promise.withResolvers<undefined>()
  window.loadURL.mockImplementation(() => loading.promise)
  const selection = promptRemoteAddress(locale.messages, userData, vi.fn())
  await vi.waitFor(() => { expect(window.loadURL).toHaveBeenCalledOnce() })
  window.close()
  loading.reject(new Error('aborted by close'))
  expect(await selection).toBeUndefined()
})

it('isolates persistent remote cookies, denies native permissions and returns to selection from the menu', async () => {
  const { window } = await fixture()
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn())
  expect(native.partition).toHaveBeenCalledWith('persist:companion')
  expect(native.create.mock.lastCall![0].webPreferences).toEqual({
    preload: '/companion/preload.cjs',
    session: native.storage, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
  })
  const callback = vi.fn()
  native.storage.setPermissionRequestHandler.mock.calls[0]![0]({}, 'media', callback, { isMainFrame: true, requestingUrl: 'https://nas.example.com/' })
  expect(callback).toHaveBeenCalledWith(false)
  const check = native.storage.setPermissionCheckHandler.mock.calls[0]![0]
  const request = native.storage.setPermissionRequestHandler.mock.calls[0]![0]
  expect(check(window.webContents, 'clipboard-sanitized-write', 'https://nas.example.com/', { isMainFrame: true })).toBe(true)
  for (const [contents, permission, origin, isMainFrame] of [
    [{}, 'clipboard-sanitized-write', 'https://nas.example.com', true],
    [window.webContents, 'media', 'https://nas.example.com', true],
    [window.webContents, 'clipboard-sanitized-write', 'https://other.example.com', true],
    [window.webContents, 'clipboard-sanitized-write', '', true],
    [window.webContents, 'clipboard-sanitized-write', 'https://nas.example.com', false],
  ] as const) {
    expect(check(contents, permission, origin, { isMainFrame })).toBe(false)
    request(contents, permission, callback, { isMainFrame, requestingUrl: origin })
    expect(callback).toHaveBeenLastCalledWith(false)
  }
  request(window.webContents, 'clipboard-sanitized-write', callback, { isMainFrame: true, requestingUrl: 'https://nas.example.com/path' })
  expect(callback).toHaveBeenLastCalledWith(true)
  expect(window.navigate('https://nas.example.com/pair-app').preventDefault).not.toHaveBeenCalled()
  const submenu = native.menu[0]!.submenu as MenuItemConstructorOptions[]
  const change = submenu[0]!.click as () => void
  change()
  expect(await result).toBe('change')
  expect(native.storage.flushStorageData).toHaveBeenCalledOnce()
})

it('starts a renderer before awaiting network observation, then opens the server', async () => {
  const { window } = await fixture()
  const renderer = Promise.withResolvers<undefined>()
  window.loadURL.mockReturnValueOnce(renderer.promise)
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn())
  expect(window.loadURL).toHaveBeenCalledExactlyOnceWith('about:blank')
  expect(monitoring.ready).not.toHaveBeenCalled()
  renderer.resolve(undefined)
  await vi.waitFor(() => { expect(window.loadURL).toHaveBeenLastCalledWith('https://nas.example.com/') })
  expect(monitoring.ready).toHaveBeenCalledOnce()
  window.close()
  expect(await result).toBe('quit')
})

it('hides a remote window to the tray, while server changes and explicit exits still close it', async () => {
  const { window } = await fixture()
  const tray = { available: true, setRunning: vi.fn() } satisfies Pick<CompanionTray, 'available' | 'setRunning'>
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn(), tray)
  const close = { preventDefault: vi.fn() }
  window.emit('close', close)
  expect(close.preventDefault).toHaveBeenCalledOnce()
  expect(window.hide).toHaveBeenCalledOnce()
  expect(monitoring.dispose).not.toHaveBeenCalled()
  const submenu = native.menu[0]!.submenu as MenuItemConstructorOptions[]
  expect(submenu.map(item => item.label).filter(Boolean)).toEqual([locale.messages.change, locale.messages.quit])
  const change = submenu[0]!.click as () => void
  change()
  expect(await result).toBe('change')
})

it('blocks cross-origin redirects and offers a return to selection', async () => {
  const { window } = await fixture()
  native.dialog.mockResolvedValue({ response: 1 })
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn())
  expect(window.navigate('https://another.example.com/', 'will-redirect').preventDefault).toHaveBeenCalledOnce()
  expect(await result).toBe('change')
})

it('leaves embedded page redirects to Chromium without changing the server window', async () => {
  const { window } = await fixture()
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn())
  const event = { preventDefault: vi.fn() }
  window.webContents.emit('will-redirect', event, 'https://embedded.example.com/', false, false)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(native.dialog).not.toHaveBeenCalled()
  window.close()
  expect(await result).toBe('quit')
})

it('keeps same-origin popup links in the remote window and opens only Web links externally', async () => {
  const { window } = await fixture()
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn())
  await vi.waitFor(() => { expect(window.loadURL).toHaveBeenLastCalledWith('https://nas.example.com/') })
  const popup = window.webContents.setWindowOpenHandler.mock.calls[0]![0]
  expect(popup({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
  expect(native.external).not.toHaveBeenCalled()
  popup({ url: 'https://nas.example.com/pair-app' })
  await vi.waitFor(() => { expect(window.loadURL).toHaveBeenLastCalledWith('https://nas.example.com/pair-app') })
  popup({ url: 'https://docs.example.com/' })
  expect(native.external).toHaveBeenCalledExactlyOnceWith('https://docs.example.com/')
  window.close()
  expect(await result).toBe('quit')
})

it('retries a failed initial load and ignores aborted or subframe loads', async () => {
  const { window } = await fixture()
  const decision = Promise.withResolvers<{ response: number }>()
  native.dialog.mockReturnValueOnce(decision.promise)
  window.loadURL.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'))
  const result = openRemoteWindow('https://nas.example.com/', locale.messages, vi.fn())
  await vi.waitFor(() => { expect(native.dialog).toHaveBeenCalledOnce() })
  window.webContents.emit('did-fail-load', {}, -105, '', '', true)
  expect(native.dialog).toHaveBeenCalledOnce()
  decision.resolve({ response: 0 })
  await vi.waitFor(() => { expect(window.loadURL).toHaveBeenCalledTimes(4) })
  expect(window.loadURL.mock.lastCall).toEqual(['https://nas.example.com/'])
  window.webContents.emit('did-fail-load', {}, -3, '', '', true)
  window.webContents.emit('did-fail-load', {}, -105, '', '', false)
  expect(native.dialog).toHaveBeenCalledOnce()
  window.close()
  expect(await result).toBe('quit')
})


it('applies restored bounds while retaining the remote window minimum size', async () => {
  const { window } = await fixture()
  const bounds = { x: 120, y: 80, width: 900, height: 700 }
  const closed = openRemoteWindow('https://nas.example.com', locale.messages, vi.fn(), undefined, bounds)
  expect(native.create.mock.lastCall![0]).toMatchObject({ ...bounds, minWidth: 520, minHeight: 600 })
  window.close()
  await expect(closed).resolves.toBe('quit')
})
