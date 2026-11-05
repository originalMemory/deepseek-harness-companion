/** One remote-window-owned desktop pet; authentication and completion observation stay in the GUI. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, screen, type MenuItemConstructorOptions, type Rectangle } from 'electron'
import { COMPANION_NAME } from './identity.ts'
import type { CompanionMessages } from './locale.ts'
import { petIntent } from './pet-protocol.ts'
import { loadWindowBounds, rememberWindowBounds } from './window-state.ts'
import { petContentLayout, petModelSize, readPetGeometry, type PetContentLayout, type PetGeometry, type PetModelSize } from './pet-layout.ts'

const petPath = '/api/dsh-companion/avatar/pet'
const layoutFile = 'pet-window-state.json'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNever(_value: never): never { throw new Error('Unhandled desktop pet intent') }

/** Owns the native pet, its IPC and polling until the associated remote GUI closes. */
export class DesktopPet {
  private window: BrowserWindow | undefined
  private enabled = false
  private scale = 1
  private model: PetModelSize = { width: 360, height: 520 }
  private geometry: PetGeometry | undefined
  private geometryPending = true
  private content: PetContentLayout | undefined
  private pendingPlacement: { bounds: Rectangle; corner: boolean } | undefined
  private zoom = 1
  private authenticated = false
  private desktop = false
  private bridgeReady = false
  private disposed = false
  private quitting = false
  private settingsReported = false
  private cleanupWindow: (() => void) | undefined
  private readonly guiContents: Electron.WebContents
  /** Called after a preference changes; omission leaves menus to their caller. */
  changed: () => void = () => {}

  /**
   * @param gui - Retained remote GUI; its existing session and main-frame identity are reused.
   * @param origin - Selected server origin, without pairing credentials.
   * @param userData - Device-local settings directory.
   * @param messages - Localized menu, recovery and storage copy.
   */
  constructor(
    private readonly gui: BrowserWindow, private readonly origin: string,
    private readonly userData: string, private readonly messages: CompanionMessages,
  ) {
    this.guiContents = gui.webContents
    try {
      const saved: unknown = JSON.parse(readFileSync(join(userData, 'pet-settings.json'), 'utf8'))
      if (!record(saved) || typeof saved.enabled !== 'boolean') throw new Error('Invalid pet preferences')
      if (saved.scale !== undefined && (typeof saved.scale !== 'number' || !Number.isFinite(saved.scale)
        || saved.scale < 0.5 || saved.scale > 1.5)) throw new Error('Invalid pet scale')
      this.enabled = saved.enabled
      this.scale = typeof saved.scale === 'number' ? saved.scale : 1
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.report(messages.petSettingsReadFailed)
    }
    app.on('before-quit', this.beginQuit)
    this.guiContents.on('will-prevent-unload', this.cancelQuit)
  }

  /** Current GUI avatar host, including model readiness and native visibility. */
  get avatarHost(): 'desktop' | 'web' { return this.desktop ? 'desktop' : 'web' }

  /**
   * Signal the existing observer's authenticated baseline; starts a selected pet once.
   * Authentication is never attempted in the pet window.
   */
  connected(): void {
    if (this.disposed || this.authenticated) return
    this.authenticated = true
    if (this.enabled) this.open()
  }

  /**
   * Build menu actions reflecting the saved user choice, including failed or loading pets.
   * @returns Fresh native items; callers refresh them after changed().
   */
  menuItems(): MenuItemConstructorOptions[] {
    return [
      { label: this.messages.showPet, type: 'checkbox', checked: this.enabled, click: () => { this.toggle() } },
      { label: this.messages.resetPetPosition, enabled: this.enabled, click: () => { this.resetPosition() } },
      { label: this.messages.petSmaller, enabled: this.enabled && this.scale > 0.5, click: () => { this.setScale(this.scale - 0.1) } },
      { label: this.messages.petLarger, enabled: this.enabled && this.scale < 1.5, click: () => { this.setScale(this.scale + 0.1) } },
      { label: this.messages.petResetScale, enabled: this.enabled, click: () => { this.setScale(1) } },
    ]
  }

  /** Toggle the user preference; write failure preserves both the preference and current window. */
  toggle(): void {
    if (this.disposed) return
    const enabled = !this.enabled
    if (!this.save(enabled, this.scale)) { this.changed(); return }
    this.enabled = enabled
    if (!enabled) this.closeWindow()
    else if (this.authenticated) this.open()
    this.changed()
  }

  private save(enabled: boolean, scale: number): boolean {
    try {
      mkdirSync(this.userData, { recursive: true, mode: 0o700 })
      writeFileSync(join(this.userData, 'pet-settings.json'), `${JSON.stringify({ enabled, scale })}\n`, { mode: 0o600 })
      this.settingsReported = false
    } catch (_error) {
      if (!this.settingsReported) { this.settingsReported = true; this.report(this.messages.petSettingsWriteFailed) }
      return false
    }
    return true
  }

  private setScale(value: number): void {
    if (this.disposed || !this.enabled) return
    const scale = Math.max(0.5, Math.min(1.5, Math.round(value * 100) / 100))
    if (scale === this.scale) return
    if (!this.save(this.enabled, scale)) { this.changed(); return }
    this.scale = scale
    this.geometryPending = true
    this.resizeModel()
    this.changed()
  }

  /**
   * Present a live completion or consume it silently when desktop mode is unavailable.
   * @param body - Already bounded, localized completion text from the existing observer.
   * @param sessionId - Navigation hint; values exceeding the page's 256-code-unit limit are omitted.
   * @returns True when desktop mode owns presentation, including unavailable pets; false selects native toasts.
   */
  present(body: string, sessionId: string): boolean {
    if (!this.enabled || this.disposed) return false
    const pet = this.window
    if (pet !== undefined && !pet.isDestroyed() && pet.isVisible() && this.desktop) {
      pet.webContents.send('companion:pet-control', {
        type: 'bubble:show', bubble: { title: COMPANION_NAME, text: body,
          ...(sessionId.length <= 256 ? { sessionId } : {}), durationMs: 12000 },
      })
    } else console.warn(this.messages.petNotificationSkipped)
    return true
  }

  /** Release native windows and all process-owned listeners without changing the saved choice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.closeWindow()
    ipcMain.removeListener('companion:pet-intent', this.intent)
    ipcMain.removeListener('companion:pet-scale', this.scaleIntent)
    app.off('before-quit', this.beginQuit)
    this.guiContents.off('will-prevent-unload', this.cancelQuit)
    this.changed = () => {}
  }

  private readonly beginQuit = (): void => { this.quitting = true }
  private readonly cancelQuit = (): void => {
    this.quitting = false
    if (this.enabled && this.authenticated && !this.disposed) this.open()
  }

  private trusted(event: Electron.IpcMainEvent, window: BrowserWindow): boolean {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame === null
      || event.senderFrame !== window.webContents.mainFrame) return false
    try {
      const url = new URL(event.senderFrame.url)
      return url.origin === this.origin && url.pathname === petPath && url.search === '' && url.hash === ''
    } catch (_error) { return false /* Provisional frames have no usable URL. */ }
  }

  private drag: { cursor: Electron.Point; bounds: Rectangle } | undefined
  private readonly scaleIntent = (event: Electron.IpcMainEvent, value: unknown): void => {
    const pet = this.window
    if (pet === undefined || !this.trusted(event, pet) || !pet.isVisible() || this.drag !== undefined
      || (value !== 1 && value !== -1)) return
    this.setScale(this.scale + value * 0.1)
  }
  private readonly intent = (event: Electron.IpcMainEvent, value: unknown): void => {
    const pet = this.window
    if (pet === undefined || !this.trusted(event, pet)) return
    const data = petIntent(value)
    if (data === undefined) return
    switch (data.type) {
      case 'ready': case 'model-ready': this.bridgeReady = true; this.sendModelLayout(); return
      case 'bubble-dismiss': return
      case 'bubble-click':
        if (!this.desktop || !pet.isVisible() || this.gui.isDestroyed()) return
        if (this.gui.isMinimized()) this.gui.restore()
        this.gui.show()
        this.gui.focus()
        return
      case 'drag-start':
        if (!this.desktop || !pet.isVisible()) return
        // Native cursor DIP avoids PointerEvent screen-coordinate differences across platforms and zoom levels.
        this.drag = { cursor: screen.getCursorScreenPoint(), bounds: pet.getContentBounds() }
        pet.setIgnoreMouseEvents(false)
        return
      case 'drag-move':
        if (this.drag !== undefined) {
          const cursor = screen.getCursorScreenPoint()
          pet.setPosition(Math.round(this.drag.bounds.x + cursor.x - this.drag.cursor.x),
            Math.round(this.drag.bounds.y + cursor.y - this.drag.cursor.y))
        }
        return
      case 'drag-end': this.drag = undefined; this.fit(); return
      default: return assertNever(data)
    }
  }

  private host(desktop: boolean): void {
    if (this.desktop === desktop) return
    this.desktop = desktop
    if (!this.gui.isDestroyed()) this.guiContents.send('companion:avatar-host-changed', desktop ? 'desktop' : 'web')
  }

  private report(message: string): void {
    console.warn(`[Companion pet] ${message}`)
    try { dialog.showErrorBox(COMPANION_NAME, message) } catch (_error) {
      // The default-enabled console report remains available without native dialogs.
    }
  }

  private defaultBounds(): Rectangle {
    const area = screen.getDisplayMatching(this.gui.getBounds()).workArea
    const zoom = this.guiContents.getZoomFactor()
    const cssArea = { ...area, width: area.width / zoom, height: area.height / zoom }
    const model = petModelSize(this.scale, cssArea)
    const content = petContentLayout(model, undefined, cssArea)
    const width = Math.ceil(content.width * zoom), height = Math.ceil(content.height * zoom)
    return { x: area.x + area.width - width, y: area.y + area.height - height, width, height }
  }

  private sendModelLayout(): void {
    const pet = this.window
    if (pet !== undefined && !pet.isDestroyed() && this.content !== undefined) {
      pet.webContents.send('companion:pet-control', {
        type: 'model-layout', ...this.model, left: this.content.left, top: this.content.top,
        bubbleWidth: this.content.bubbleWidth, bubbleLeft: this.content.bubbleLeft, bubbleMaxHeight: this.content.bubbleMaxHeight,
      })
    }
  }

  private applyContent(next: PetContentLayout, preserveFeet: boolean, zoom: number): void {
    const pet = this.window
    if (pet === undefined || pet.isDestroyed()) return
    const bounds = pet.getContentBounds(), previous = this.content
    const area = screen.getDisplayMatching(bounds).workArea
    const width = Math.min(area.width, Math.ceil(next.width * zoom))
    const height = Math.min(area.height, Math.ceil(next.height * zoom))
    let x: number, y: number
    if (this.pendingPlacement !== undefined && this.geometry !== undefined) {
      const target = this.pendingPlacement
      x = target.corner ? target.bounds.x + target.bounds.width - width : target.bounds.x + (target.bounds.width - width) / 2
      y = target.bounds.y + target.bounds.height - height
      this.pendingPlacement = undefined
    } else if (previous === undefined) {
      x = bounds.x + (bounds.width - width) / 2
      y = bounds.y + bounds.height - height
    } else if (preserveFeet) {
      x = bounds.x + (previous.body.x + previous.body.width / 2) * this.zoom - (next.body.x + next.body.width / 2) * zoom
      y = bounds.y + (previous.body.y + previous.body.height) * this.zoom - (next.body.y + next.body.height) * zoom
    } else {
      x = bounds.x + previous.left * this.zoom - next.left * zoom
      y = bounds.y + previous.top * this.zoom - next.top * zoom
    }
    const fitted = { width, height,
      x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
    }
    const changed = previous === undefined || previous.left !== next.left || previous.top !== next.top
      || previous.bubbleWidth !== next.bubbleWidth || previous.bubbleLeft !== next.bubbleLeft || previous.bubbleMaxHeight !== next.bubbleMaxHeight
    this.content = next
    this.zoom = zoom
    if (fitted.width !== bounds.width || fitted.height !== bounds.height || fitted.x !== bounds.x || fitted.y !== bounds.y) {
      pet.setBounds(fitted)
    }
    if (changed) this.sendModelLayout()
  }

  private resizeModel(): void {
    const pet = this.window
    if (pet === undefined || pet.isDestroyed()) return
    this.drag = undefined
    const bounds = pet.getContentBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const zoom = pet.webContents.getZoomFactor()
    const cssArea = { ...area, width: area.width / zoom, height: area.height / zoom }
    const model = petModelSize(this.scale, cssArea)
    if (model.width !== this.model.width || model.height !== this.model.height || zoom !== this.zoom) this.geometryPending = true
    this.model = model
    this.applyContent(petContentLayout(this.model, this.geometry, cssArea), true, zoom)
    this.sendModelLayout()
  }

  private compact(layout: unknown): boolean {
    const pet = this.window
    if (pet === undefined || pet.isDestroyed()) return false
    if (this.drag !== undefined) return this.geometry !== undefined
    if (this.geometryPending || this.geometry === undefined) {
      const geometry = readPetGeometry(layout, this.model)
      if (geometry === undefined) return false
      this.geometry = geometry
      this.geometryPending = false
    } else {
      if (!record(layout) || typeof layout.bubbleHeight !== 'number' || !Number.isFinite(layout.bubbleHeight)
        || layout.bubbleHeight < 0 || layout.bubbleHeight > 320) return false
      if (layout.bubbleHeight === this.geometry.bubbleHeight) return true
      this.geometry = { ...this.geometry, bubbleHeight: layout.bubbleHeight }
    }
    const area = screen.getDisplayMatching(pet.getContentBounds()).workArea
    const cssArea = { ...area, width: area.width / this.zoom, height: area.height / this.zoom }
    this.applyContent(petContentLayout(this.model, this.geometry, cssArea), false, this.zoom)
    return true
  }

  private resetPosition(): void {
    const pet = this.window
    if (pet === undefined || pet.isDestroyed()) return
    const bounds = this.defaultBounds()
    pet.setBounds(bounds)
    this.pendingPlacement = { bounds, corner: true }
    this.content = undefined
    this.resizeModel()
  }

  private readonly fit = (): void => {
    const pet = this.window
    if (pet === undefined || pet.isDestroyed()) return
    this.drag = undefined
    const bounds = pet.getContentBounds()
    const area = screen.getDisplayMatching(bounds).workArea
    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    pet.setBounds({ width, height,
      x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
    })
    this.resizeModel()
  }

  private closeWindow(): void {
    const pet = this.window
    this.window = undefined
    this.cleanupWindow?.()
    this.cleanupWindow = undefined
    this.drag = undefined
    this.pendingPlacement = undefined
    this.bridgeReady = false
    this.host(false)
    if (pet !== undefined && !pet.isDestroyed()) {
      pet.webContents.send('companion:pet-control', { type: 'visibility', visible: false })
      pet.hide()
      pet.destroy()
    }
    this.geometry = undefined
    this.geometryPending = true
    this.content = undefined
  }

  private open(): void {
    if (this.disposed || this.window !== undefined) return
    let pet: BrowserWindow
    let saved: Rectangle | undefined
    try {
      saved = loadWindowBounds(this.userData, { windowStateReadFailed: this.messages.petLayoutReadFailed }, layoutFile)
      pet = new BrowserWindow({
        ...this.defaultBounds(), ...saved,
        frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
        resizable: false, maximizable: false, fullscreenable: false, show: false, skipTaskbar: true,
        title: COMPANION_NAME,
        webPreferences: {
          preload: fileURLToPath(new URL('./pet-preload.cjs', import.meta.url)),
          session: this.guiContents.session, nodeIntegration: false, contextIsolation: true,
          sandbox: true, webSecurity: true, backgroundThrottling: false,
        },
      })
    } catch (_error) { this.report(this.messages.petUnavailable); return }
    this.window = pet
    this.geometry = undefined
    this.geometryPending = true
    this.content = undefined
    this.pendingPlacement = { bounds: pet.getContentBounds(), corner: saved === undefined }
    ipcMain.on('companion:pet-intent', this.intent)
    ipcMain.on('companion:pet-scale', this.scaleIntent)
    this.resizeModel()
    pet.setMenu(null)
    pet.setAlwaysOnTop(true, 'floating')
    if (process.platform === 'darwin') pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    pet.setIgnoreMouseEvents(true, { forward: true })
    const remember = rememberWindowBounds(pet, this.userData, this.messages, layoutFile, () => {
      const bounds = pet.getNormalBounds(), body = this.content?.body
      if (body === undefined || this.geometry === undefined) return bounds
      // Persist the character's position, independent of a transient notification's larger viewport.
      return {
        x: Math.round(bounds.x + (body.x - 12) * this.zoom),
        y: Math.round(bounds.y + (body.y - 12) * this.zoom),
        width: Math.ceil((body.width + 24) * this.zoom), height: Math.ceil((body.height + 24) * this.zoom),
      }
    })
    const contents = pet.webContents
    let generation = 0
    let loaded = false
    let nativeReady = false
    let shown = false
    let hadState = false
    let busy = false
    let queryStarted = 0
    let deadline = Date.now() + 30_000
    let timer: ReturnType<typeof setInterval> | undefined
    const current = (): boolean => this.window === pet && !pet.isDestroyed()
    const fail = (): void => {
      if (!current()) return
      this.closeWindow()
      this.report(this.messages.petUnavailable)
    }
    const fence = (event: Electron.Event, target: string): void => {
      if (target !== new URL(petPath, this.origin).href) { event.preventDefault(); fail() }
    }
    contents.on('will-navigate', fence)
    contents.on('will-redirect', (event, target, _inPage, mainFrame) => { if (mainFrame) fence(event, target) })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('render-process-gone', fail)
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) fail() })
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (!mainFrame || inPlace || !current()) return
      generation++
      loaded = false
      hadState = false
      this.bridgeReady = false
      this.geometryPending = true
      this.drag = undefined
      this.host(false)
      pet.setIgnoreMouseEvents(true, { forward: true })
      deadline = Date.now() + 30_000
    })
    contents.on('did-finish-load', () => { loaded = true })
    pet.on('ready-to-show', () => { nativeReady = true })
    pet.on('blur', () => { this.drag = undefined })
    pet.on('hide', () => {
      if (!current()) return
      clearInterval(timer)
      timer = undefined
      deadline = Infinity
      this.drag = undefined
      this.host(false)
      contents.send('companion:pet-control', { type: 'visibility', visible: false })
    })
    pet.on('show', () => {
      if (!current()) return
      deadline = Date.now() + 30_000
      contents.send('companion:pet-control', { type: 'visibility', visible: true })
      monitor()
    })
    pet.on('close', event => { if (!this.quitting) { event.preventDefault(); this.toggle() } })
    pet.once('closed', () => {
      if (!current() && this.window !== pet) return
      this.window = undefined
      this.cleanupWindow?.()
      this.cleanupWindow = undefined
      this.drag = undefined
      this.host(false)
    })
    screen.on('display-added', this.fit).on('display-removed', this.fit).on('display-metrics-changed', this.fit)
    const check = (): void => {
      if (!current()) return
      if (Date.now() > deadline || (busy && Date.now() - queryStarted > 5_000)) { fail(); return }
      if (!loaded || busy) return
      if (contents.getZoomFactor() !== this.zoom) this.resizeModel()
      busy = true
      queryStarted = Date.now()
      const epoch = generation
      const checkPointer = pet.isVisible() && this.drag === undefined
      const bounds = pet.getContentBounds()
      const cursor = checkPointer ? screen.getCursorScreenPoint() : { x: bounds.x, y: bounds.y }
      const x = (cursor.x - bounds.x) / bounds.width
      const y = (cursor.y - bounds.y) / bounds.height
      if (!Number.isFinite(x) || !Number.isFinite(y)) { busy = false; fail(); return }
      // Coordinates are finite native numbers; all remote text travels through the preload's data channel.
      const script = `(() => {
        const p = window.dshCompanionPet;
        if (!p) return null;
        const state = p.getState();
        const stage = ${this.geometryPending ? "document.getElementById('companion-pet-stage')?.getBoundingClientRect()" : 'null'};
        const panel = document.querySelector('.dsh-avatar-bubble');
        const text = panel?.querySelector('.dsh-avatar-bubble-text');
        return { state, layout: {
          ...(stage && state.headAnchor ? {
          width: stage.width, height: stage.height, bounds: state.bounds,
          headX: state.headAnchor.x - stage.left, headY: state.headAnchor.y - stage.top,
          } : {}),
          bubbleHeight: panel && !panel.hidden && text
            ? Math.min(320, panel.getBoundingClientRect().height + Math.max(0, text.scrollHeight - text.clientHeight)) : 0,
        }, hit: ${checkPointer ? `p.hitTest(${JSON.stringify(x)}*innerWidth,${JSON.stringify(y)}*innerHeight).hit` : 'false'} };
      })()`
      void contents.executeJavaScript(script).then((value: unknown) => {
        if (!current() || epoch !== generation) return
        if (!record(value) || !record(value.state) || value.state.version !== 1
          || typeof value.state.ready !== 'boolean' || typeof value.state.visible !== 'boolean' || typeof value.hit !== 'boolean') {
          if (hadState) { fail(); return }
          this.host(false)
          pet.setIgnoreMouseEvents(true, { forward: true })
          return
        }
        hadState = true
        if (value.state.ready && this.bridgeReady) {
          const cropped = this.compact(value.layout)
          if (cropped) deadline = Infinity
          else if (deadline === Infinity) deadline = Date.now() + 30_000
          if (nativeReady && !shown && cropped) { shown = true; pet.showInactive() }
        } else if (this.bridgeReady && !value.state.ready) {
          this.geometryPending = true
          this.drag = undefined
          if (!value.state.visible) deadline = Infinity
          else if (deadline === Infinity) deadline = Date.now() + 30_000
        }
        this.host(this.bridgeReady && value.state.ready && value.state.visible && pet.isVisible())
        pet.setIgnoreMouseEvents(!(this.drag !== undefined || (this.desktop && value.hit)), { forward: true })
      }).catch(() => { if (current() && epoch === generation) fail() })
        .finally(() => { busy = false })
    }
    const monitor = (): void => { timer ??= setInterval(check, 80) }
    monitor()
    this.cleanupWindow = () => {
      generation++
      clearInterval(timer)
      ipcMain.removeListener('companion:pet-intent', this.intent)
      ipcMain.removeListener('companion:pet-scale', this.scaleIntent)
      screen.off('display-added', this.fit).off('display-removed', this.fit).off('display-metrics-changed', this.fit)
      // Destroy emits closed after this callback so the existing bounds owner can persist cached normal bounds.
      if (pet.isDestroyed()) remember()
    }
    void pet.loadURL(new URL(petPath, this.origin).href).catch(fail)
  }
}
