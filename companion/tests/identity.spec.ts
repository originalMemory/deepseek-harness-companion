import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { COMPANION_APP_ID, COMPANION_NAME, initializeCompanionIdentity } from '../src/identity.ts'

it('assigns isolated data and Chromium storage before single-instance ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'companion-identity-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const application = {
    setName: vi.fn(), getPath: vi.fn((_name: string) => root), setPath: vi.fn(), setAppUserModelId: vi.fn(),
  }
  const directory = initializeCompanionIdentity(application)
  expect(directory).toBe(join(root, COMPANION_NAME))
  expect(application.setName).toHaveBeenCalledWith(COMPANION_NAME)
  expect(application.setPath.mock.calls).toEqual([['userData', directory], ['sessionData', directory]])
  expect(directory).not.toBe(join(root, 'DeepSeek Harness'))
  if (process.platform === 'win32') expect(application.setAppUserModelId).toHaveBeenCalledWith(COMPANION_APP_ID)
})

it('packages the same Companion name and identifier without claiming official protocols or updates', () => {
  const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    productName: string; build: { appId: string; productName: string; protocols?: unknown; publish: unknown }
  }
  expect(metadata.productName).toBe(COMPANION_NAME)
  expect(metadata.build.productName).toBe(COMPANION_NAME)
  expect(metadata.build.appId).toBe(COMPANION_APP_ID)
  expect(metadata.build.protocols).toBeUndefined()
  expect(metadata.build.publish).toBeNull()
})
