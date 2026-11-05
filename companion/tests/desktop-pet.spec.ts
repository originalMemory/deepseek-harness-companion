import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { app, BrowserWindow, ipcMain, screen, type BrowserWindowConstructorOptions, type IpcMainEvent, type Rectangle } from 'electron'
import { DesktopPet } from '../src/desktop-pet.ts'
import { companionMessages } from '../src/locale.ts'

const native = vi.hoisted(() => ({
  windows: [] as FakeWindow[], error: vi.fn(), cursor: { x: 1000, y: 500 },
  query: vi.fn<(script: string) => Promise<unknown>>(), zoom: 1,
}))
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions = {}) { return new FakeWindow(options) }),
  dialog: { showErrorBox: native.error }, ipcMain: new EventEmitter(),
  app: new EventEmitter(),
  screen: Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } }),
    getCursorScreenPoint: () => ({ ...native.cursor }),
  }),
}))

class FakeWindow extends EventEmitter {
  destroyed = false
  visible = false
  bounds: Rectangle
  webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'https://nas.example.com/' }, session: {}, send: vi.fn(),
    getZoomFactor: () => native.zoom,
    executeJavaScript: native.query,
    setWindowOpenHandler: vi.fn(),
  })
  constructor(readonly options: BrowserWindowConstructorOptions) {
    super()
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 900, height: options.height ?? 700 }
    native.windows.push(this)
  }
  isDestroyed = () => this.destroyed
  isVisible = () => this.visible
  isMinimized = () => false
  getNormalBounds = () => this.bounds
  getBounds = () => this.bounds
  getContentBounds = () => this.bounds
  setBounds = vi.fn((bounds: Rectangle) => { this.bounds = bounds; this.emit('move'); this.emit('resize') })
  setPosition = vi.fn((x: number, y: number) => { this.bounds = { ...this.bounds, x, y }; this.emit('move') })
  setIgnoreMouseEvents = vi.fn()
  setMenu = vi.fn()
  setAlwaysOnTop = vi.fn()
  setVisibleOnAllWorkspaces = vi.fn()
  showInactive = vi.fn(() => { this.visible = true; this.emit('show') })
  show = vi.fn(() => { this.visible = true; this.emit('show') })
  hide = vi.fn(() => { this.visible = false; this.emit('hide') })
  focus = vi.fn()
  loadURL = vi.fn(async (url: string) => {
    this.webContents.mainFrame.url = url
    this.webContents.emit('did-start-navigation', {}, url, false, true)
    if (url.endsWith('/avatar/pet')) ipcMain.emit('companion:pet-intent', {
      sender: this.webContents, senderFrame: this.webContents.mainFrame,
    }, { type: 'ready', version: 1 })
    this.webContents.emit('did-finish-load')
    this.emit('ready-to-show')
  })
  destroy = (): void => { this.destroyed = true; this.emit('closed') }
}

let root: string
let owners: DesktopPet[]
const messages = companionMessages('en')
const response = (ready = true, visible = true, hit = true) => ({ state: { version: 1, ready, visible },
  layout: { width: 360, height: 520, headX: 180, headY: 44, bubbleHeight: 0,
    bounds: { left: 0, top: 0, right: 1, bottom: 1 } }, hit })
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'companion-pet-'))
  owners = []
  native.windows.length = 0
  native.error.mockClear()
  native.query.mockReset().mockResolvedValue(response())
  native.cursor = { x: 1000, y: 500 }
  native.zoom = 1
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers()
})
afterEach(async () => {
  for (const owner of owners) owner.dispose()
  expect(ipcMain.listenerCount('companion:pet-intent')).toBe(0)
  expect(ipcMain.listenerCount('companion:pet-scale')).toBe(0)
  expect(ipcMain.listenerCount('companion:avatar-host')).toBe(0)
  expect(screen.listenerCount('display-removed')).toBe(0)
  expect(app.listenerCount('before-quit')).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

function setup(language = 'en') {
  const gui = new BrowserWindow()
  const owner = new DesktopPet(gui, 'https://nas.example.com', root, companionMessages(language))
  owners.push(owner)
  const send = (data: unknown, window = native.windows[1]!, event?: Partial<IpcMainEvent>) => {
    ipcMain.emit('companion:pet-intent', { sender: window.webContents, senderFrame: window.webContents.mainFrame, ...event }, data)
  }
  const initial = () => owner.avatarHost
  return { gui, owner, send, initial }
}

it.each(['en', 'zh-CN'])('owns desktop pet menu copy and selection states for %s', async language => {
  const s = setup(language)
  const items = () => s.owner.menuItems().map(({ label, checked, enabled }) => ({ label, checked, enabled }))
  const off = items()
  s.owner.toggle()
  await expect(JSON.stringify({ off, on: items() }, null, 2) + '\n')
    .toMatchFileSnapshot(`./expected/desktop-pet-${language}.json`)
})

it('defaults off, waits for existing authentication, persists selection and reuses the exact session', async () => {
  const s = setup()
  expect(s.owner.present('body', 's')).toBe(false)
  s.owner.toggle()
  expect(native.windows).toHaveLength(1)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8'))).toEqual({ enabled: true, scale: 1 })
  s.owner.connected()
  const pet = native.windows[1]!
  expect(pet.options.webPreferences).toMatchObject({ session: s.gui.webContents.session,
    nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false })
  expect(pet.options).toMatchObject({ frame: false, transparent: true, resizable: false, show: false })
  expect(pet.loadURL).toHaveBeenCalledWith('https://nas.example.com/api/dsh-companion/avatar/pet')
  expect(s.initial()).toBe('web')
  await vi.advanceTimersByTimeAsync(160)
  expect(s.initial()).toBe('desktop')
  expect(pet.showInactive).toHaveBeenCalledOnce()
  s.owner.present('<b>plain text</b>', 'other')
  expect(pet.webContents.send).toHaveBeenCalledWith('companion:pet-control', {
    type: 'bubble:show', bubble: { title: 'DeepSeek Harness Companion', text: '<b>plain text</b>', sessionId: 'other', durationMs: 12000 },
  })
  s.owner.present('bounded hint', 's'.repeat(257))
  expect(pet.webContents.send).toHaveBeenLastCalledWith('companion:pet-control', {
    type: 'bubble:show', bubble: { title: 'DeepSeek Harness Companion', text: 'bounded hint', durationMs: 12000 },
  })
  s.owner.dispose()
  expect(pet.destroyed).toBe(true)
  expect(JSON.parse(await readFile(join(root, 'pet-window-state.json'), 'utf8'))).toEqual(pet.bounds)
  const restored = setup()
  restored.owner.connected()
  expect(native.windows).toHaveLength(4)
})

it('waits for real model readiness, restores the GUI when unavailable and never falls back to a toast', async () => {
  native.query.mockResolvedValue(response(false))
  const s = setup()
  s.owner.connected(); s.owner.toggle()
  await vi.advanceTimersByTimeAsync(160)
  expect(native.windows[1]!.showInactive).not.toHaveBeenCalled()
  expect(s.owner.present('unavailable', 's')).toBe(true)
  expect(s.initial()).toBe('web')
  native.query.mockResolvedValue(response())
  await vi.advanceTimersByTimeAsync(160)
  expect(s.initial()).toBe('desktop')
  native.query.mockResolvedValue(response(false))
  await vi.advanceTimersByTimeAsync(80)
  expect(s.initial()).toBe('web')
  s.owner.toggle()
  expect(s.owner.present('native', 's')).toBe(false)
})

it('uses viewport ratios for hit testing and native DIP for dragging without trusting page screen coordinates', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  const pet = native.windows[1]!
  await vi.advanceTimersByTimeAsync(160)
  expect(native.query.mock.calls.length).toBe(2)
  expect(pet.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
  const beforeDrag = { ...pet.bounds }
  s.send({ type: 'drag-start', screenX: 900000, screenY: -900000 })
  native.cursor = { x: 1050, y: 470 }
  s.send({ type: 'drag-move', screenX: 0, screenY: 0 })
  expect(pet.setPosition).toHaveBeenLastCalledWith(beforeDrag.x + 50, beforeDrag.y - 30)
  s.send({ type: 'drag-end', screenX: 0, screenY: 0 })
  expect(pet.bounds.x).toBe(1200 - pet.bounds.width)
  s.send({ type: 'drag-move', screenX: 500, screenY: 500 })
  expect(pet.setPosition).toHaveBeenCalledOnce()
  native.query.mockResolvedValue(response(true, true, false))
  await vi.advanceTimersByTimeAsync(80)
  expect(pet.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  native.query.mockResolvedValue(response())
  await vi.advanceTimersByTimeAsync(80)
  expect(pet.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
})

it('rejects foreign senders, child frames, wrong origins, paths and malformed intents', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  const click = { type: 'bubble-click', sessionId: 's' }
  s.send(click, pet, { sender: s.gui.webContents })
  s.send(click, pet, { senderFrame: { url: pet.webContents.mainFrame.url } as Electron.WebFrameMain })
  for (const url of ['https://evil.example.com/api/dsh-companion/avatar/pet', 'https://nas.example.com/other']) {
    pet.webContents.mainFrame.url = url
    s.send(click)
  }
  pet.webContents.mainFrame.url = 'https://nas.example.com/api/dsh-companion/avatar/pet'
  s.send({ ...click, extra: true })
  expect(s.gui.focus).not.toHaveBeenCalled()
  s.send({ type: 'bubble-dismiss', reason: 'manual' })
  expect(s.gui.focus).not.toHaveBeenCalled()
  s.send(click)
  expect(s.gui.focus).toHaveBeenCalledOnce()
  expect(s.gui.webContents.send).not.toHaveBeenCalledWith('companion:focus-composer')
})

it('discards an in-flight old-page result and bounds hung queries without piling up work', async () => {
  const pending = Promise.withResolvers<unknown>()
  native.query.mockReturnValueOnce(pending.promise)
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  const pet = native.windows[1]!
  await vi.advanceTimersByTimeAsync(800)
  expect(native.query).toHaveBeenCalledOnce()
  pet.webContents.emit('did-start-navigation', {}, pet.webContents.mainFrame.url, false, true)
  pending.resolve(response())
  await vi.advanceTimersByTimeAsync(80)
  expect(s.initial()).toBe('web')
  pet.webContents.emit('did-finish-load')
  native.query.mockImplementation(() => new Promise(() => {}))
  await vi.advanceTimersByTimeAsync(5200)
  expect(pet.destroyed).toBe(true)
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', messages.petUnavailable)
  expect(s.owner.present('no fallback', 's')).toBe(true)
})

it('keeps a native-hidden pet paused, restores initial host on GUI reload, and clears every owned resource', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  expect(s.initial()).toBe('desktop')
  pet.hide()
  expect(vi.getTimerCount()).toBe(0)
  const callsBeforeHidden = native.query.mock.calls.length
  native.query.mockResolvedValue(response(true, false, false))
  await vi.advanceTimersByTimeAsync(160)
  expect(native.query).toHaveBeenCalledTimes(callsBeforeHidden)
  expect(s.initial()).toBe('web')
  expect(pet.showInactive).toHaveBeenCalledOnce()
  expect(pet.webContents.send).toHaveBeenCalledWith('companion:pet-control', { type: 'visibility', visible: false })
  pet.show()
  native.query.mockResolvedValue(response())
  await vi.advanceTimersByTimeAsync(80)
  expect(s.initial()).toBe('desktop')
  s.owner.dispose()
  expect(pet.destroyed).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('requires a new preload handshake after reload even when the page claims model readiness', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  pet.webContents.emit('did-start-navigation', {}, pet.webContents.mainFrame.url, false, true)
  pet.webContents.emit('did-finish-load')
  await vi.advanceTimersByTimeAsync(160)
  expect(s.initial()).toBe('web')
  await vi.advanceTimersByTimeAsync(30_000)
  expect(pet.destroyed).toBe(true)
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', messages.petUnavailable)
})

it('waits while the shared avatar is disabled and resumes when the same page enables it', async () => {
  native.query.mockResolvedValue(response(false, false, false))
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(31_000)
  expect(native.windows[1]!.destroyed).toBe(false)
  expect(s.initial()).toBe('web')
  native.query.mockResolvedValue(response())
  await vi.advanceTimersByTimeAsync(160)
  expect(s.initial()).toBe('desktop')
})

it('reports bad settings, preserves the current selection on write failure, and fits disconnected displays', async () => {
  await writeFile(join(root, 'pet-settings.json'), 'invalid')
  const s = setup()
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', messages.petSettingsReadFailed)
  s.owner.connected(); s.owner.toggle()
  const pet = native.windows[1]!
  pet.bounds = { x: 4000, y: 4000, width: 360, height: 680 }
  screen.emit('display-removed')
  expect(pet.bounds).toEqual({ x: 840, y: 120, width: 360, height: 612 })
  await rm(join(root, 'pet-settings.json'))
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(root, 'pet-settings.json'))
  s.owner.toggle()
  expect(pet.destroyed).toBe(false)
  expect(s.owner.menuItems()[0]!.checked).toBe(true)
  expect(native.error).toHaveBeenLastCalledWith('DeepSeek Harness Companion', messages.petSettingsWriteFailed)
})

it('places and resets the pet on the GUI display instead of the primary display', () => {
  const s = setup()
  const gui = native.windows[0]!
  gui.bounds = { x: 2400, y: 1200, width: 1100, height: 1300 }
  const matching = vi.spyOn(screen, 'getDisplayMatching').mockReturnValue({
    workArea: { x: 1440, y: 1150, width: 2560, height: 1410 },
  } as Electron.Display)
  s.owner.connected(); s.owner.toggle()
  const pet = native.windows[1]!
  expect(pet.bounds).toEqual({ x: 3640, y: 1948, width: 360, height: 612 })
  expect(matching).toHaveBeenCalledWith(gui.bounds)
  pet.bounds = { x: 1080, y: 1880, width: 360, height: 680 }
  const reset = s.owner.menuItems()[1]!.click as () => void
  reset()
  expect(pet.bounds).toEqual({ x: 3640, y: 1948, width: 360, height: 612 })
  expect(matching).toHaveBeenCalledWith(gui.bounds)
})

it('preserves the saved choice on app quit and recreates a closed pet if the GUI cancels quitting', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  const pet = native.windows[1]!
  app.emit('before-quit', { preventDefault: vi.fn() })
  const event = { preventDefault: vi.fn() }
  pet.emit('close', event)
  expect(event.preventDefault).not.toHaveBeenCalled()
  pet.destroy()
  expect(s.owner.menuItems()[0]!.checked).toBe(true)
  s.gui.webContents.emit('will-prevent-unload', { preventDefault: vi.fn() })
  expect(native.windows).toHaveLength(3)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8'))).toEqual({ enabled: true, scale: 1 })
})

it('changes only the model stage, persists the scale, and bounds repeated zoom intents', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  const zoom = (value: unknown) => ipcMain.emit('companion:pet-scale', {
    sender: pet.webContents, senderFrame: pet.webContents.mainFrame,
  }, value)
  const bottom = pet.bounds.y + pet.bounds.height
  zoom(-1)
  expect(pet.webContents.send).toHaveBeenLastCalledWith('companion:pet-control', expect.objectContaining({ type: 'model-layout', width: 324, height: 468 }))
  expect(pet.bounds.width).toBe(348)
  expect(pet.bounds.y + pet.bounds.height).toBe(bottom)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8'))).toEqual({ enabled: true, scale: 0.9 })
  for (let n = 0; n < 10; n++) zoom(-1)
  expect(s.owner.menuItems()[2]!.enabled).toBe(false)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8')).scale).toBe(0.5)
  for (let n = 0; n < 20; n++) zoom(1)
  expect(s.owner.menuItems()[3]!.enabled).toBe(false)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8')).scale).toBe(1.5)
  for (const invalid of [0, NaN, '1', 2, {}, null]) zoom(invalid)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8')).scale).toBe(1.5)
  ;(s.owner.menuItems()[4]!.click as () => void)()
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8')).scale).toBe(1)
})

it('rejects scale intents from the GUI, subframes, hidden pets and an active drag', async () => {
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  ipcMain.emit('companion:pet-scale', { sender: s.gui.webContents, senderFrame: s.gui.webContents.mainFrame }, 1)
  ipcMain.emit('companion:pet-scale', { sender: pet.webContents, senderFrame: {} }, 1)
  s.send({ type: 'drag-start', screenX: 0, screenY: 0 })
  ipcMain.emit('companion:pet-scale', { sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, 1)
  pet.hide()
  ipcMain.emit('companion:pet-scale', { sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, 1)
  expect(JSON.parse(await readFile(join(root, 'pet-settings.json'), 'utf8')).scale).toBe(1)
})

it('crops bubble space without moving the canvas, and releases that space when the bubble closes', async () => {
  const layout = { width: 360, height: 520, headX: 180, headY: 44, bubbleHeight: 72,
    bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 } }
  native.query.mockResolvedValue({ ...response(), layout })
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  pet.setBounds({ ...pet.bounds, x: 300, y: 200 })
  const origin = { x: pet.bounds.x + 2, y: pet.bounds.y + 52 }
  native.query.mockResolvedValue({ ...response(), layout: { ...layout, bubbleHeight: 320 } })
  await vi.advanceTimersByTimeAsync(80)
  expect(pet.bounds.width).toBe(364)
  expect(pet.bounds.height).toBe(780)
  // The work-area top contains an oversized upward expansion.
  expect(pet.bounds.y).toBe(0)
  const afterClampY = pet.bounds.y + 300
  native.query.mockResolvedValue({ ...response(), layout: { ...layout, bubbleHeight: 0 } })
  await vi.advanceTimersByTimeAsync(80)
  expect(pet.bounds.width).toBe(240)
  expect(pet.bounds.height).toBe(440)
  expect(pet.bounds.x - 60).toBe(origin.x)
  expect(pet.bounds.y - 40).toBe(afterClampY)
})

it('crops canvas transparency to the visible contour with fixed margins', async () => {
  native.query.mockResolvedValue({ ...response(), layout: {
    width: 360, height: 520, headOffset: 44, headX: 180, headY: 44, bubbleHeight: 0,
    bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 },
  } })
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  expect(pet.bounds.width).toBe(240)
  expect(pet.bounds.height).toBe(440)
  expect(pet.webContents.send).toHaveBeenCalledWith('companion:pet-control', expect.objectContaining({
    type: 'model-layout', left: -60, top: -40,
  }))
  const before = { ...pet.bounds }
  s.owner.dispose()
  const restored = setup()
  restored.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  expect(native.windows[3]!.bounds).toEqual(before)
})

it.each(['center', 'screen edge'])('keeps native bounds and stage placement fixed during animation at the %s', async position => {
  const layout = { width: 360, height: 520, headX: 180, headY: 44, bubbleHeight: 0,
    bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 } }
  native.query.mockResolvedValue({ ...response(), layout })
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  if (position === 'center') pet.setBounds({ ...pet.bounds, x: 300, y: 200 })
  const before = { ...pet.bounds }
  const nativeUpdates = pet.setBounds.mock.calls.length
  const stageUpdates = pet.webContents.send.mock.calls.filter(call => call[1]?.type === 'model-layout').length
  native.query.mockResolvedValue({ ...response(), layout: { ...layout,
    headX: 190, headY: 48, bounds: { left: 0.15, top: 0.09, right: 0.85, bottom: 0.91 } } })
  await vi.advanceTimersByTimeAsync(800)
  expect(pet.bounds).toEqual(before)
  expect(pet.setBounds).toHaveBeenCalledTimes(nativeUpdates)
  expect(pet.webContents.send.mock.calls.filter(call => call[1]?.type === 'model-layout')).toHaveLength(stageUpdates)
  native.query.mockResolvedValue({ ...response(true, true, false), layout })
  await vi.advanceTimersByTimeAsync(80)
  expect(pet.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
})

it('checks the first matching post-scale frame once, then stops sampling animated placement', async () => {
  const layout = { width: 360, height: 520, headX: 180, headY: 44, bubbleHeight: 0,
    bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 } }
  native.query.mockResolvedValue({ ...response(), layout })
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  expect(native.query.mock.lastCall![0]).toContain('const stage = null')
  const pet = native.windows[1]!
  ipcMain.emit('companion:pet-scale', { sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, 1)
  const projected = { ...pet.bounds }, projectedUpdates = pet.setBounds.mock.calls.length
  await vi.advanceTimersByTimeAsync(80)
  expect(pet.bounds).toEqual(projected)
  expect(pet.setBounds).toHaveBeenCalledTimes(projectedUpdates)
  expect(native.query.mock.lastCall![0]).not.toContain('const stage = null')
  const scaled = { ...layout, width: 396, height: 572, headX: 198, headY: 48.4,
    bounds: { left: 0.15, top: 0.1, right: 0.85, bottom: 0.9 } }
  native.query.mockResolvedValue({ ...response(), layout: scaled })
  await vi.advanceTimersByTimeAsync(80)
  const checked = { ...pet.bounds }, checkedUpdates = pet.setBounds.mock.calls.length
  native.query.mockResolvedValue({ ...response(), layout: { ...scaled,
    headX: 210, headY: 52, bounds: { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 } } })
  await vi.advanceTimersByTimeAsync(800)
  expect(pet.bounds).toEqual(checked)
  expect(pet.setBounds).toHaveBeenCalledTimes(checkedUpdates)
  expect(native.query.mock.lastCall![0]).toContain('const stage = null')
})

it('converts cropped CSS dimensions and hit coordinates at non-default Chromium zoom', async () => {
  native.zoom = 1.25
  native.query.mockResolvedValue({ ...response(), layout: {
    width: 360, height: 520, headX: 180, headY: 44, bubbleHeight: 0,
    bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 },
  } })
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  expect(native.windows[1]!.bounds.width).toBe(300)
  expect(native.windows[1]!.bounds.height).toBe(550)
})

it('restores the character position when quitting with a wider bubble visible', async () => {
  const layout = { width: 360, height: 520, headX: 160, headY: 44, bubbleHeight: 72,
    bounds: { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 } }
  native.query.mockResolvedValue({ ...response(), layout })
  const s = setup()
  s.owner.toggle(); s.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const pet = native.windows[1]!
  const bodyCenter = pet.bounds.x + 202, bodyBottom = pet.bounds.y + 520
  s.owner.dispose()
  native.query.mockResolvedValue({ ...response(), layout: { ...layout, bubbleHeight: 0 } })
  const restored = setup()
  restored.owner.connected()
  await vi.advanceTimersByTimeAsync(160)
  const next = native.windows[3]!
  expect(next.bounds.x + next.bounds.width / 2).toBe(bodyCenter)
  expect(next.bounds.y + next.bounds.height - 12).toBe(bodyBottom)
})
