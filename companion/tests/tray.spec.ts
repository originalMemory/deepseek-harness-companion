import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions, NativeImage, Tray } from 'electron'
import { CompanionTray } from '../src/tray.ts'
import { companionMessages } from '../src/locale.ts'

const native = vi.hoisted(() => ({
  trays: [] as unknown[], images: [] as unknown[], menu: [] as MenuItemConstructorOptions[], fail: false,
  error: vi.fn(),
}))
vi.mock('electron', () => ({
  dialog: { showErrorBox: native.error },
  nativeImage: { createFromPath: (path: string) => {
    const image = { path, isEmpty: () => false, setTemplateImage: vi.fn() }
    native.images.push(image)
    return image
  } },
  Menu: { buildFromTemplate: (menu: MenuItemConstructorOptions[]) => { native.menu = menu; return menu } },
  Tray: class extends EventEmitter {
    constructor(_image: unknown) { super(); native.trays.push(this) }
    setContextMenu = vi.fn()
    setToolTip = vi.fn()
    setTitle = vi.fn()
    setImage = vi.fn(() => { if (native.fail) throw new Error('tray unavailable') })
    destroy = vi.fn()
  },
}))

beforeEach(() => { vi.clearAllMocks(); native.trays.length = 0; native.images.length = 0; native.fail = false })
afterEach(() => { vi.restoreAllMocks() })

it('uses official Windows artwork and the original open/quit tray interaction', () => {
  const open = vi.fn()
  const quit = vi.fn()
  const messages = companionMessages('en')
  const owner = new CompanionTray(messages, open, quit, 'win32')
  const tray = native.trays[0] as Tray
  tray.emit('click')
  expect(open).toHaveBeenCalledOnce()
  expect(native.menu.map(item => item.label).filter(Boolean)).toEqual([messages.openApplication, messages.quit])
  const exit = native.menu[2]!.click as () => void
  exit()
  expect(quit).toHaveBeenCalledOnce()
  const source = readFileSync(new URL('../../apps/desktop/resources/tray-windows.ico', import.meta.url))
  const copied = readFileSync(new URL('../assets/tray.ico', import.meta.url))
  expect(copied).toEqual(source)
  owner.setRunning(2)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  expect(tray.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness Companion — Replying (2)')
  owner.setRunning(0)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
  owner.dispose()
  owner.dispose()
  expect(tray.destroy).toHaveBeenCalledOnce()
  expect(owner.available).toBe(false)
})

it('uses a macOS template whale and a visible running dot without an animation timer', () => {
  const owner = new CompanionTray(companionMessages('zh-CN'), vi.fn(), vi.fn(), 'darwin')
  const template = native.images[0] as NativeImage
  expect(template.setTemplateImage).toHaveBeenCalledWith(true)
  const tray = native.trays[0] as Tray
  owner.setRunning(1)
  expect(tray.setTitle).toHaveBeenLastCalledWith('●')
  expect(tray.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness Companion — 正在回复（1）')
  owner.setRunning(undefined)
  expect(tray.setTitle).toHaveBeenLastCalledWith('')
  expect(tray.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness Companion — 等待会话状态')
  owner.dispose()
})

it('restores window access and disables close-to-tray if native status updates fail', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const open = vi.fn()
  const owner = new CompanionTray(companionMessages('en'), open, vi.fn(), 'win32')
  native.fail = true
  owner.setRunning(1)
  expect(owner.available).toBe(false)
  expect(open).toHaveBeenCalledOnce()
  expect(native.error).toHaveBeenCalledOnce()
})

it('allows explicit quit through close-to-tray and resumes if the page cancels unload', () => {
  let quitting = false
  const owner = new CompanionTray(companionMessages('en'), vi.fn(), vi.fn(), 'win32', () => quitting)
  quitting = true
  expect(owner.available).toBe(false)
  quitting = false
  expect(owner.available).toBe(true)
  owner.dispose()
})
