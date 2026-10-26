import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { BrowserWindow, type Rectangle } from 'electron'
import { loadWindowBounds, rememberWindowBounds } from '../src/window-state.ts'
import { companionMessages } from '../src/locale.ts'

const native = vi.hoisted(() => ({
  bounds: { x: 120, y: 80, width: 900, height: 700 },
  workArea: { x: 0, y: 24, width: 1920, height: 1056 },
  error: vi.fn(), display: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    isDestroyed = () => false
    getNormalBounds = () => ({ ...native.bounds })
  },
  dialog: { showErrorBox: native.error },
  screen: { getDisplayMatching: (bounds: Rectangle) => { native.display(bounds); return { workArea: native.workArea } } },
}))
const messages = companionMessages('en')

beforeEach(() => {
  vi.clearAllMocks()
  native.bounds = { x: 120, y: 80, width: 900, height: 700 }
  native.workArea = { x: 0, y: 24, width: 1920, height: 1056 }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'companion-window-state-'))
  const window = new BrowserWindow()
  onTestFinished(() => { window.emit('closed'); rmSync(directory, { recursive: true, force: true }) })
  return { directory, window, file: join(directory, 'window-state.json') }
}

it('uses default placement on first launch without reporting a storage error', () => {
  const { directory } = fixture()
  expect(loadWindowBounds(directory, messages)).toBeUndefined()
  expect(native.error).not.toHaveBeenCalled()
  expect(native.display).not.toHaveBeenCalled()
})

it('restores the latest normal bounds after hiding and closing', () => {
  const { directory, window, file } = fixture()
  rememberWindowBounds(window, directory, messages)
  for (const event of ['hide', 'close']) {
    native.bounds = { ...native.bounds, x: native.bounds.x + 20, width: native.bounds.width + 20 }
    window.emit(event)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(native.bounds)
    expect(loadWindowBounds(directory, messages)).toEqual(native.bounds)
  }
  window.emit('closed')
  expect(window.listenerCount('hide')).toBe(0)
  expect(window.listenerCount('close')).toBe(0)
})

it('keeps valid negative coordinates on a secondary display', () => {
  const { directory, file } = fixture()
  const saved = { x: -1800, y: 80, width: 1100, height: 800 }
  native.workArea = { x: -1920, y: 0, width: 1920, height: 1080 }
  writeFileSync(file, JSON.stringify(saved))
  expect(loadWindowBounds(directory, messages)).toEqual(saved)
})

it('fits a removed or smaller display layout into the current work area', () => {
  const { directory, file } = fixture()
  native.workArea = { x: 0, y: 24, width: 1440, height: 900 }
  writeFileSync(file, JSON.stringify({ x: 2500, y: 1800, width: 1800, height: 1200 }))
  expect(loadWindowBounds(directory, messages)).toEqual({ x: 0, y: 24, width: 1440, height: 900 })
})

it.each([
  '{', 'null', '{}',
  JSON.stringify({ x: '120', y: 80, width: 900, height: 700 }),
  JSON.stringify({ x: 120, y: 80, width: 0, height: 700 }),
  JSON.stringify({ x: 120, y: 80, width: 900, height: -1 }),
  JSON.stringify({ x: 2_147_483_648, y: 80, width: 900, height: 700 }),
])('reports invalid saved data and uses default placement: %s', raw => {
  const { directory, file } = fixture()
  writeFileSync(file, raw)
  expect(loadWindowBounds(directory, messages)).toBeUndefined()
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', messages.windowStateReadFailed)
  expect(native.display).not.toHaveBeenCalled()
})

it('reports a save failure once and can save after directory access is repaired', () => {
  const { directory, window } = fixture()
  const blocked = join(directory, 'blocked')
  writeFileSync(blocked, 'not a directory')
  rememberWindowBounds(window, blocked, messages)
  window.emit('hide')
  window.emit('hide')
  expect(native.error).toHaveBeenCalledTimes(1)
  expect(native.error).toHaveBeenCalledWith('DeepSeek Harness Companion', messages.windowStateWriteFailed)
  rmSync(blocked)
  window.emit('close')
  expect(loadWindowBounds(blocked, messages)).toEqual(native.bounds)
})

it('stops saving after its listener disposer runs', () => {
  const { directory, window } = fixture()
  const dispose = rememberWindowBounds(window, directory, messages)
  dispose()
  window.emit('hide')
  expect(loadWindowBounds(directory, messages)).toBeUndefined()
  expect(window.listenerCount('closed')).toBe(0)
})

it('keeps default placement available when the native storage-error dialog fails', () => {
  const { directory, file } = fixture()
  writeFileSync(file, '{')
  native.error.mockImplementationOnce(() => { throw new Error('Native dialog unavailable') })
  expect(loadWindowBounds(directory, messages)).toBeUndefined()
  expect(console.warn).toHaveBeenCalled()
})
