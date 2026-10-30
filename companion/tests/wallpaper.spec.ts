import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { BrowserWindow, ipcMain } from 'electron'
import { installWallpaper } from '../src/wallpaper.ts'
import type { WallpaperSettings } from '../src/wallpaper-settings.ts'
import { wallpaperDefaults } from '../src/wallpaper-settings.ts'

const native = vi.hoisted(() => ({ directory: '', apply: undefined as undefined | ((value: WallpaperSettings, next: boolean) => Promise<boolean>), error: vi.fn(), send: vi.fn(), valid: true, files: ['a.png', 'b.png'], readFailure: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => native.directory },
  ipcMain: new EventEmitter(),
  BrowserWindow: class extends EventEmitter {
    show = vi.fn()
    focus = vi.fn()
    isDestroyed = () => false
    destroy() { this.emit('closed') }
    webContents = Object.assign(new EventEmitter(), { mainFrame: { url: 'https://server.example/' }, getURL: () => 'https://server.example/', send: native.send })
  },
  dialog: { showErrorBox: native.error },
}))
vi.mock('../src/wallpaper-dialog.ts', () => ({
  openWallpaperDialog: (_parent: BrowserWindow, _initial: WallpaperSettings, apply: typeof native.apply) => {
    native.apply = apply
    return new BrowserWindow()
  },
}))
vi.mock('../src/wallpaper-files.ts', () => ({
  scanWallpapers: async (directory: string) => directory === '/empty' ? [] : directory === '/single' ? ['b.png'] : native.files,
  wallpaperData: async (_dir: string, path: string) => {
    if (path === native.readFailure) throw new Error('image no longer readable')
    return `data:image/png;base64,${path}`
  },
  nextWallpaper: (count: number, current: number) => (current + 1) % count,
}))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); native.apply = undefined; native.files = ['a.png', 'b.png']; native.readFailure = '' })

it('pushes on rotation and reload, preserves the image when settings change, and releases its timer on close', async () => {
  native.directory = await mkdtemp(join(tmpdir(), 'companion-rotation-'))
  onTestFinished(() => rm(native.directory, { recursive: true, force: true }))
  await writeFile(join(native.directory, 'wallpaper.json'), JSON.stringify({ ...wallpaperDefaults, enabled: true, dir: '/images', intervalMin: 1 }))
  vi.useFakeTimers()
  const window = new BrowserWindow()
  const contents = window.webContents
  native.valid = true
  native.send.mockImplementation((channel: string, id: number) => {
    if (channel === 'companion:wallpaper-check') queueMicrotask(() => ipcMain.emit('companion:wallpaper-checked', { sender: contents, senderFrame: contents.mainFrame }, id, native.valid))
  })
  const show = installWallpaper(window, 'https://server.example')
  onTestFinished(() => { window.emit('closed') })
  await vi.waitFor(() => expect(native.send).toHaveBeenCalledWith('companion:wallpaper', expect.objectContaining({ image: expect.stringContaining('a.png') })))
  contents.emit('did-finish-load')
  expect(native.send).toHaveBeenCalledTimes(2)
  show()
  await vi.waitFor(() => expect(native.apply).toBeDefined())
  await native.apply!({ ...wallpaperDefaults, dir: '/images', enabled: true, intervalMin: 1, dim: 30 }, false)
  await vi.waitFor(() => expect(native.send).toHaveBeenLastCalledWith('companion:wallpaper', expect.objectContaining({ dim: 30, image: expect.stringContaining('a.png') })))
  expect(JSON.parse(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).dim).toBe(30)
  const saved = await readFile(join(native.directory, 'wallpaper.json'), 'utf8')
  native.valid = false
  expect(await native.apply!({ ...wallpaperDefaults, dir: '/bad', enabled: true }, false)).toBe(false)
  expect(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).toBe(saved)
  expect(native.send).not.toHaveBeenCalledWith('companion:wallpaper', null)
  expect(vi.getTimerCount()).toBe(1)
  native.valid = true
  expect(await native.apply!({ ...wallpaperDefaults, dir: '/empty', enabled: true }, false)).toBe(false)
  expect(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).toBe(saved)
  expect(vi.getTimerCount()).toBe(1)
  native.error.mockClear()
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.waitFor(() => expect(native.send).toHaveBeenLastCalledWith('companion:wallpaper', expect.objectContaining({ image: expect.stringContaining('b.png') })))
  expect(native.error).not.toHaveBeenCalled()
  ipcMain.emit('companion:wallpaper-failed', { sender: {}, senderFrame: contents.mainFrame })
  expect(native.error).not.toHaveBeenCalled()
  ipcMain.emit('companion:wallpaper-failed', { sender: contents, senderFrame: contents.mainFrame })
  expect(native.error).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(1)
  Object.defineProperty(window, 'webContents', { get: () => { throw new Error('Object has been destroyed') } })
  expect(() => window.emit('closed')).not.toThrow()
  expect(ipcMain.listenerCount('companion:wallpaper-failed')).toBe(0)
  expect(ipcMain.listenerCount('companion:wallpaper-checked')).toBe(0)
  expect(contents.listenerCount('did-finish-load')).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  const calls = native.send.mock.calls.length
  await vi.advanceTimersByTimeAsync(120_000)
  expect(native.send).toHaveBeenCalledTimes(calls)
})

it('ignores unowned validation replies and cancels pending saves when the window closes', async () => {
  native.directory = await mkdtemp(join(tmpdir(), 'companion-check-close-'))
  onTestFinished(() => rm(native.directory, { recursive: true, force: true }))
  const saved = JSON.stringify({ ...wallpaperDefaults, enabled: true, dir: '/images', intervalMin: 1 })
  await writeFile(join(native.directory, 'wallpaper.json'), saved)
  vi.useFakeTimers()
  native.send.mockReset()
  const window = new BrowserWindow()
  const contents = window.webContents
  const open = installWallpaper(window, 'https://server.example')
  onTestFinished(() => { window.emit('closed') })
  await vi.waitFor(() => expect(native.send).toHaveBeenCalledWith('companion:wallpaper', expect.anything()))
  open()
  await vi.waitFor(() => expect(native.apply).toBeDefined())
  const pending = native.apply!({ ...wallpaperDefaults, enabled: true, dir: '/changed' }, false)
  await vi.waitFor(() => expect(native.send).toHaveBeenCalledWith('companion:wallpaper-check', expect.any(Number), expect.any(String)))
  const id = native.send.mock.calls.find(call => call[0] === 'companion:wallpaper-check')![1]
  ipcMain.emit('companion:wallpaper-checked', { sender: {}, senderFrame: contents.mainFrame }, id, true)
  ipcMain.emit('companion:wallpaper-checked', { sender: contents, senderFrame: contents.mainFrame }, id + 1, true)
  expect(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).toBe(saved)
  window.emit('closed')
  expect(await pending).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  expect(native.error).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).toBe(saved)
})


it.each([['read', 'sequence'], ['decode', 'sequence'], ['timeout', 'sequence'], ['read', 'random'], ['decode', 'random'], ['timeout', 'random']] as const)('continues rotation after a single %s failure in %s order', async (failure, order) => {
  native.directory = await mkdtemp(join(tmpdir(), 'companion-rotation-recovery-'))
  onTestFinished(() => rm(native.directory, { recursive: true, force: true }))
  await writeFile(join(native.directory, 'wallpaper.json'), JSON.stringify({ ...wallpaperDefaults, enabled: true, dir: '/images', intervalMin: 1, order }))
  vi.useFakeTimers()
  native.files = ['a.png', 'b.png', 'c.png']
  native.readFailure = failure === 'read' ? 'b.png' : ''
  native.send.mockReset()
  const window = new BrowserWindow()
  const contents = window.webContents
  native.send.mockImplementation((channel: string, id: number, source: string) => {
    if (channel !== 'companion:wallpaper-check') return
    if (failure === 'timeout' && source.endsWith('b.png')) return
    queueMicrotask(() => ipcMain.emit('companion:wallpaper-checked', { sender: contents, senderFrame: contents.mainFrame }, id, !source.endsWith('b.png')))
  })
  const open = installWallpaper(window, 'https://server.example')
  onTestFinished(() => { window.emit('closed') })
  await vi.waitFor(() => expect(native.send).toHaveBeenCalledWith('companion:wallpaper', expect.objectContaining({ image: expect.stringContaining('a.png') })))
  const preferences = await readFile(join(native.directory, 'wallpaper.json'), 'utf8')
  await vi.advanceTimersByTimeAsync(60_000)
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(10_000)
  await vi.waitFor(() => expect(native.error).toHaveBeenCalledOnce())
  expect(vi.getTimerCount()).toBe(1)
  expect(native.send).not.toHaveBeenCalledWith('companion:wallpaper', null)
  expect(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).toBe(preferences)
  if (failure === 'decode' && order === 'random') {
    open()
    await vi.waitFor(() => expect(native.apply).toBeDefined())
    expect(await native.apply!({ ...wallpaperDefaults, enabled: true, dir: '/single', order }, false)).toBe(false)
    expect(await readFile(join(native.directory, 'wallpaper.json'), 'utf8')).toBe(preferences)
    expect(native.send).not.toHaveBeenCalledWith('companion:wallpaper', null)
  }
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.waitFor(() => expect(native.send).toHaveBeenLastCalledWith('companion:wallpaper', expect.objectContaining({ image: expect.stringContaining('c.png') })))
  expect(vi.getTimerCount()).toBe(1)
  window.emit('closed')
  expect(vi.getTimerCount()).toBe(0)
})

it('does not run an expired timer against settings saved while image validation was pending', async () => {
  native.directory = await mkdtemp(join(tmpdir(), 'companion-rotation-settings-'))
  onTestFinished(() => rm(native.directory, { recursive: true, force: true }))
  const config = { ...wallpaperDefaults, enabled: true, dir: '/images', intervalMin: 1, order: 'sequence' as const }
  await writeFile(join(native.directory, 'wallpaper.json'), JSON.stringify(config))
  vi.useFakeTimers()
  native.send.mockReset()
  const window = new BrowserWindow()
  const contents = window.webContents
  let released = false
  const event = { sender: contents, senderFrame: contents.mainFrame }
  native.send.mockImplementation((channel: string, id: number) => {
    if (channel === 'companion:wallpaper-check' && released) queueMicrotask(() => ipcMain.emit('companion:wallpaper-checked', event, id, true))
  })
  const open = installWallpaper(window, 'https://server.example')
  onTestFinished(() => { window.emit('closed') })
  await vi.waitFor(() => expect(native.send).toHaveBeenCalledWith('companion:wallpaper', expect.anything()))
  await vi.advanceTimersByTimeAsync(55_000)
  open()
  await vi.waitFor(() => expect(native.apply).toBeDefined())
  const saving = native.apply!({ ...config, dim: 30 }, false)
  await vi.waitFor(() => expect(native.send).toHaveBeenCalledWith('companion:wallpaper-check', expect.any(Number), expect.any(String)))
  const id = native.send.mock.calls.find(call => call[0] === 'companion:wallpaper-check')![1]
  await vi.advanceTimersByTimeAsync(5_000)
  released = true
  ipcMain.emit('companion:wallpaper-checked', event, id, true)
  expect(await saving).toBe(true)
  await vi.advanceTimersByTimeAsync(0)
  expect(native.send.mock.calls.filter(call => call[0] === 'companion:wallpaper-check')).toHaveLength(1)
  expect(native.send).toHaveBeenLastCalledWith('companion:wallpaper', expect.objectContaining({ image: expect.stringContaining('a.png'), dim: 30 }))
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.waitFor(() => expect(native.send).toHaveBeenLastCalledWith('companion:wallpaper', expect.objectContaining({ image: expect.stringContaining('b.png'), dim: 30 })))
})
