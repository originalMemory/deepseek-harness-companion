/** Official DesktopTray interaction and whale assets adapted for Companion and macOS running status. */
import { Menu, nativeImage, Tray, dialog, type NativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import { COMPANION_NAME } from './identity.ts'
import type { CompanionMessages } from './locale.ts'

/** System-tray owner; the original implementation is apps/desktop/src/tray.ts. */
export class CompanionTray {
  private tray: Tray | undefined
  private readonly idle: NativeImage
  private readonly busy: NativeImage
  private running: number | undefined
  private focused = false
  private unread = false
  private lit = true
  private animation: ReturnType<typeof setInterval> | undefined

  /**
   * @param messages - Localized menu and activity copy.
   * @param open - Show and focus the current window.
   * @param quit - Explicit application quit, shared with the application menu.
   * @param platform - Native target; tests can exercise macOS without changing process globals.
   * @param exiting - Whether an explicit application quit must close windows instead of hiding them; omission means false.
   */
  constructor(
    private readonly messages: CompanionMessages, private readonly open: () => void, quit: () => void,
    private readonly platform: string = process.platform,
    private readonly exiting: () => boolean = () => false,
  ) {
    this.idle = nativeImage.createFromPath(fileURLToPath(new URL(
      platform === 'darwin' ? '../assets/trayTemplate.png' : '../assets/tray.ico', import.meta.url,
    )))
    this.busy = platform === 'darwin' ? this.idle
      : nativeImage.createFromPath(fileURLToPath(new URL('../assets/tray-running.ico', import.meta.url)))
    const icon = this.idle
    if (icon.isEmpty() || (platform !== 'darwin' && this.busy.isEmpty())) throw new Error('Companion tray icon is unavailable')
    if (platform === 'darwin') icon.setTemplateImage(true)
    const tray = new Tray(icon)
    this.tray = tray
    try {
      tray.on('click', open)
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: messages.openApplication, click: open },
        { type: 'separator' },
        { label: messages.quit, click: quit },
      ]))
      this.setRunning(undefined)
    } catch (error) { this.dispose(); throw error }
  }

  /** Whether a window close may hide to the tray without blocking explicit quit. */
  get available(): boolean { return this.tray !== undefined && !this.exiting() }

  /**
   * Show observed running work; unknown coverage never claims idle.
   * @param count - Observed running turns, or undefined while disconnected or awaiting a baseline.
   */
  setRunning(count: number | undefined): void {
    this.running = count
    this.refresh()
  }

  /** Update remote-window attention; returning to a visible focused window clears unread replies.
   * @param focused - Whether the remote window is visible and focused.
   */
  setFocused(focused: boolean): void {
    this.focused = focused
    if (focused) this.unread = false
    this.refresh()
  }

  /** Retain a background completion until the user returns to the remote window. */
  markUnread(): void {
    if (this.focused) return
    this.unread = true
    this.refresh()
  }

  private refresh(): void {
    clearInterval(this.animation)
    this.animation = undefined
    this.lit = true
    this.paint()
    if (this.tray !== undefined && !this.focused && this.running !== undefined && this.running > 0) {
      this.animation = setInterval(() => { this.lit = !this.lit; this.paint() }, 800)
    }
  }

  private paint(): void {
    const tray = this.tray
    if (tray === undefined) return
    try {
      const working = this.running !== undefined && this.running > 0
      const badge = !this.focused && (working ? this.lit : this.unread)
      if (this.platform === 'darwin') tray.setTitle(badge ? '●' : !this.focused && working ? ' ' : '', { fontType: 'monospaced' })
      else tray.setImage(badge ? this.busy : this.idle)
      const status = this.running === undefined ? this.messages.activityUnknown : working
        ? this.messages.activityRunning.replace('{count}', String(this.running)) : this.messages.activityIdle
      tray.setToolTip(`${COMPANION_NAME} — ${status}${this.unread ? ' · 有未读回复' : ''}`)
    } catch (_error) {
      this.dispose()
      this.open()
      console.warn(this.messages.trayUnavailable)
      dialog.showErrorBox(COMPANION_NAME, this.messages.trayUnavailable)
    }
  }

  /** Remove the native icon after window teardown, or after a tray failure. */
  dispose(): void {
    clearInterval(this.animation)
    this.animation = undefined
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}
