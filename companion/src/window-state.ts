/** Device-local normal-window bounds, independent of the remote server and browser profile. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog, screen, type BrowserWindow, type Rectangle } from 'electron'
import { COMPANION_NAME } from './identity.ts'
import type { CompanionMessages } from './locale.ts'

function showStorageError(message: string): void {
  try { dialog.showErrorBox(COMPANION_NAME, message) } catch (error) { console.warn(message, error) }
}

function boundsRecord(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every(key => typeof record[key] === 'number'
    && Number.isInteger(record[key]) && Math.abs(record[key]) <= 2_147_483_647)
    && typeof record.width === 'number' && record.width > 0
    && typeof record.height === 'number' && record.height > 0
}

/**
 * Read saved bounds and fit them to the best matching display's current work area.
 * @param userData - Companion-owned preference directory.
 * @param messages - Localized storage failure copy.
 * @returns Valid bounds, or undefined on first use or after a reported read failure.
 */
export function loadWindowBounds(userData: string, messages: CompanionMessages): Rectangle | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(userData, 'window-state.json'), 'utf8'))
    if (!boundsRecord(value)) throw new Error('Invalid Companion window bounds')
    const area = screen.getDisplayMatching(value).workArea
    const width = Math.min(value.width, area.width)
    const height = Math.min(value.height, area.height)
    return {
      x: Math.min(Math.max(value.x, area.x), area.x + area.width - width),
      y: Math.min(Math.max(value.y, area.y), area.y + area.height - height), width, height,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(messages.windowStateReadFailed, error)
      showStorageError(messages.windowStateReadFailed)
    }
    return undefined
  }
}

/**
 * Save the latest normal bounds when the window hides or closes.
 * @param window - Remote application window; maximized and fullscreen dimensions are not stored.
 * @param userData - Companion-owned preference directory.
 * @param messages - Localized storage failure copy; repeated failures show one dialog per window.
 * @returns Disposer for the window-owned listeners; also runs when the window closes.
 */
export function rememberWindowBounds(window: BrowserWindow, userData: string, messages: CompanionMessages): () => void {
  let previous: string | undefined
  let reported = false
  const save = (): void => {
    if (window.isDestroyed()) return
    try {
      const raw = `${JSON.stringify(window.getNormalBounds())}\n`
      if (raw === previous) return
      mkdirSync(userData, { recursive: true, mode: 0o700 })
      // shortcut: failed writes can lose this resettable layout; use atomic replacement before storing critical state.
      writeFileSync(join(userData, 'window-state.json'), raw, { mode: 0o600 })
      previous = raw
    } catch (error) {
      console.warn(messages.windowStateWriteFailed, error)
      if (!reported) { reported = true; showStorageError(messages.windowStateWriteFailed) }
    }
  }
  const dispose = (): void => {
    window.off('hide', save).off('close', save)
    window.off('closed', dispose)
  }
  window.on('hide', save).on('close', save)
  window.once('closed', dispose)
  return dispose
}
