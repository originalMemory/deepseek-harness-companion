/** Native completion reminders driven by read-only Chromium network observation. */
import { Notification, dialog, type BrowserWindow } from 'electron'
import { COMPANION_NAME } from './identity.ts'
import { CompletionProtocol, type CompletionNotice } from './completion-protocol.ts'
import type { CompanionMessages } from './locale.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Owns debugger listeners and native toasts until its remote window closes. */
export class CompletionNotifications {
  /**
   * Initialize observation after an initial document has created the renderer target.
   * @returns Readiness or a reported observer failure; normal remote navigation may proceed in either case.
   */
  get ready(): Promise<void> { return this.attach() }
  private readonly protocol: CompletionProtocol
  private readonly notifications = new Set<Notification>()
  private readonly contents: Electron.WebContents
  private readonly debugger: Electron.Debugger
  private disposed = false
  private closing = false
  private reported = false
  private attaching: Promise<void> | undefined

  /**
   * @param window - Owned remote window; no JavaScript or IPC is exposed to its page.
   * @param origin - Selected server origin, also used to restrict observable sockets.
   * @param messages - Localized notification and failure copy.
   * @param activity - Updates the tray with observed running turns, or undefined when observation is unavailable.
   * @param unread - Marks a live background completion independently of native notification availability.
   */
  constructor(
    private readonly window: BrowserWindow, origin: string, private readonly messages: CompanionMessages,
    activity: (count: number | undefined) => void = () => {},
    private readonly unread: () => void = () => {},
  ) {
    this.protocol = new CompletionProtocol(origin, notice => { this.show(notice) }, activity)
    this.contents = window.webContents
    this.debugger = this.contents.debugger
    this.debugger.on('message', this.message)
    this.debugger.on('detach', this.detached)
    this.contents.on('devtools-closed', this.restart)
    this.contents.on('did-start-navigation', this.navigating)
    this.contents.on('will-prevent-unload', this.keepOpen)
    window.on('close', this.beginClose)
  }

  /** Release all listeners and owned toasts; server connections are never changed. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.debugger.off('message', this.message)
    this.debugger.off('detach', this.detached)
    this.contents.off('devtools-closed', this.restart)
    this.contents.off('did-start-navigation', this.navigating)
    this.contents.off('will-prevent-unload', this.keepOpen)
    this.window.off('close', this.beginClose)
    if (!this.contents.isDestroyed() && this.debugger.isAttached()) this.debugger.detach()
    for (const notification of this.notifications) { notification.removeAllListeners(); notification.close() }
    this.notifications.clear()
    this.protocol.reset()
  }

  private readonly message = (_event: Electron.Event, method: string, params: unknown): void => {
    if (this.disposed || !record(params) || typeof params.requestId !== 'string') return
    if (method === 'Network.webSocketCreated' && typeof params.url === 'string') {
      this.protocol.created(params.requestId, params.url)
    } else if (method === 'Network.webSocketClosed') this.protocol.closed(params.requestId)
    else if (record(params.response) && params.response.opcode === 1 && typeof params.response.payloadData === 'string') {
      if (method === 'Network.webSocketFrameSent') this.protocol.sent(params.requestId, params.response.payloadData)
      else if (method === 'Network.webSocketFrameReceived') this.protocol.received(params.requestId, params.response.payloadData)
    }
  }

  private readonly navigating = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean): void => {
    if (mainFrame && !inPlace) { this.protocol.reset(); this.reported = false }
  }

  private readonly detached = (_event: Electron.Event, reason: string): void => {
    this.protocol.reset()
    if (this.disposed || this.closing || this.window.isDestroyed() || this.contents.isDestroyed() || reason === 'target_closed') return
    if (reason === 'replaced_with_devtools' || this.contents.isDevToolsOpened()) console.warn(this.messages.observerPaused)
    else this.report(this.messages.observerUnavailable)
  }

  private readonly restart = (): void => {
    this.reported = false
    void this.attach().then(() => { this.report(this.messages.observerReloadRequired) })
  }
  private readonly beginClose = (event: Electron.Event): void => { if (!event.defaultPrevented) this.closing = true }
  private readonly keepOpen = (): void => { this.closing = false }

  private attach(): Promise<void> {
    if (this.disposed || this.closing || this.contents.isDestroyed() || this.contents.isDevToolsOpened()) return Promise.resolve()
    if (this.attaching !== undefined) return this.attaching
    this.attaching = (async () => {
      try {
        if (!this.debugger.isAttached()) this.debugger.attach('1.3')
        await this.debugger.sendCommand('Network.enable')
      } catch (_error) {
        // Observer failure leaves normal browsing available; no raw network data enters diagnostics.
        if (!this.disposed && !this.window.isDestroyed()) this.report(this.messages.observerUnavailable)
      }
    })().finally(() => { this.attaching = undefined })
    return this.attaching
  }

  private show(notice: CompletionNotice): void {
    if (this.disposed || this.window.isDestroyed() || (this.window.isVisible() && this.window.isFocused())) return
    let body: string
    switch (notice.outcome) {
      case 'completed': body = notice.preview || this.messages.replyCompleted; break
      case 'error': body = this.messages.replyFailed; break
      case 'aborted': return
      case 'ended': body = this.messages.turnEnded; break
    }
    this.unread()
    this.toast(body)
  }

  private toast(body: string): void {
    if (this.disposed || this.window.isDestroyed()) return
    if (!Notification.isSupported()) { this.report(this.messages.notificationUnavailable); return }
    try {
      const notification = new Notification({ title: COMPANION_NAME, body })
      this.notifications.add(notification)
      const release = (): void => { this.notifications.delete(notification); notification.removeAllListeners() }
      notification.once('close', release)
      notification.once('click', () => {
        release()
        if (this.window.isDestroyed()) return
        if (this.window.isMinimized()) this.window.restore()
        this.window.show()
        this.window.focus()
      })
      notification.once('failed', () => { release(); this.report(this.messages.notificationUnavailable) })
      if (this.notifications.size > 32) {
        const oldest = this.notifications.values().next().value!
        this.notifications.delete(oldest)
        oldest.removeAllListeners()
        oldest.close()
      }
      notification.show()
    } catch (_error) { this.report(this.messages.notificationUnavailable) }
  }

  private report(message: string): void {
    console.warn(`[Companion notifications] ${message}`)
    if (this.reported || this.disposed || this.closing || this.window.isDestroyed()) return
    this.reported = true
    try { dialog.showErrorBox(COMPANION_NAME, message) } catch (_error) {
      // The console report above remains available when the native error dialog cannot open.
    }
  }
}
