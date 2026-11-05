/** Companion identity is assigned before Chromium storage and the single-instance lock. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from 'electron'

/** Product name, data directory name and native window title suffix. */
export const COMPANION_NAME = 'DeepSeek Harness Companion'
/** Windows taskbar identity and packaged application identifier. */
export const COMPANION_APP_ID = 'com.deepseek.harness.companion'

/**
 * Assign independent storage and OS identity before app readiness or instance ownership.
 * @param application - Electron application singleton.
 * @returns Companion-only preference directory; filesystem failures stop startup.
 */
export function initializeCompanionIdentity(application: Pick<App, 'setName' | 'getPath' | 'setPath' | 'setAppUserModelId'>): string {
  application.setName(COMPANION_NAME)
  const directory = join(application.getPath('appData'), COMPANION_NAME)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  application.setPath('userData', directory)
  application.setPath('sessionData', directory)
  if (process.platform === 'win32') application.setAppUserModelId(COMPANION_APP_ID)
  return directory
}
