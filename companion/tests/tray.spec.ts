import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { beforeEach, afterEach, expect, it, onTestFinished, vi } from 'vitest'
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
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('keeps idle and badged macOS artwork within the same standard and Retina dimensions', () => {
  for (const scale of [1, 2]) {
    const suffix = scale === 1 ? '' : '@2x'
    const idle = readFileSync(new URL(`../assets/trayTemplate${suffix}.png`, import.meta.url))
    const busy = readFileSync(new URL(`../assets/trayBadgeTemplate${suffix}.png`, import.meta.url))
    for (const png of [idle, busy]) {
      expect(png.readUInt32BE(16)).toBe(22 * scale)
      expect(png.readUInt32BE(20)).toBe(16 * scale)
    }
    expect(busy).not.toEqual(idle)
  }
})

it('uses official Windows artwork and the original open/quit tray interaction', () => {
  const open = vi.fn()
  const quit = vi.fn()
  const messages = companionMessages('en')
  const owner = new CompanionTray(messages, open, quit, 'win32')
  onTestFinished(() => owner.dispose())
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

it('blinks while work runs, retains unread completions, and clears unread replies on focus', () => {
  vi.useFakeTimers()
  const owner = new CompanionTray(companionMessages('zh-CN'), vi.fn(), vi.fn(), 'darwin')
  const template = native.images[0] as NativeImage
  expect(template.setTemplateImage).toHaveBeenCalledWith(true)
  expect((native.images[1] as NativeImage).setTemplateImage).toHaveBeenCalledWith(true)
  onTestFinished(() => owner.dispose())
  const tray = native.trays[0] as Tray
  owner.setRunning(1)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  expect(tray.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness Companion — 正在回复（1）')
  vi.advanceTimersByTime(800)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
  vi.advanceTimersByTime(800)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  owner.markUnread()
  owner.setRunning(0)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  expect(vi.getTimerCount()).toBe(0)
  owner.setRunning(undefined)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  owner.setFocused(true)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
  expect(tray.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness Companion — 等待会话状态')
  owner.setRunning(2)
  expect(vi.getTimerCount()).toBe(1)
  owner.setFocused(false)
  expect(vi.getTimerCount()).toBe(1)
  owner.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['darwin', 'win32'])('keeps the %s running indicator active across foreground and background changes', (platform) => {
  vi.useFakeTimers()
  const owner = new CompanionTray(companionMessages('en'), vi.fn(), vi.fn(), platform)
  onTestFinished(() => owner.dispose())
  const tray = native.trays[0] as Tray
  const badge = (lit: boolean): void => {
    expect(tray.setImage).toHaveBeenLastCalledWith(native.images[lit ? 1 : 0])
    expect(tray.setTitle).not.toHaveBeenCalled()
  }
  owner.setFocused(true)
  owner.setRunning(1)
  badge(true)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(800)
  badge(false)
  owner.setFocused(false)
  badge(true)
  vi.advanceTimersByTime(800)
  badge(false)
  owner.setFocused(true)
  badge(true)
  vi.advanceTimersByTime(800)
  badge(false)
  owner.setRunning(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
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

it.each(['darwin', 'win32'])('blinks the %s badge and keeps it unread until the remote window regains focus', (platform) => {
  vi.useFakeTimers()
  const owner = new CompanionTray(companionMessages('zh-CN'), vi.fn(), vi.fn(), platform)
  onTestFinished(() => owner.dispose())
  const tray = native.trays[0] as Tray
  owner.setRunning(1)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  vi.advanceTimersByTime(800)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
  vi.advanceTimersByTime(800)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  owner.markUnread()
  owner.setRunning(0)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(2400)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[1])
  expect(tray.setTitle).not.toHaveBeenCalled()
  owner.setFocused(true)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
  owner.setFocused(false)
  expect(tray.setImage).toHaveBeenLastCalledWith(native.images[0])
  owner.dispose()
  expect(vi.getTimerCount()).toBe(0)
})
