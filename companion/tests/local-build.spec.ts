import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execute: vi.fn<(command: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>>(),
  spawn: vi.fn(), access: vi.fn(), mkdtemp: vi.fn(), rename: vi.fn(), rm: vi.fn(), readFile: vi.fn(),
}))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: mocks.execute }), spawn: mocks.spawn,
}))
vi.mock('node:fs/promises', () => ({
  access: mocks.access, mkdtemp: mocks.mkdtemp, rename: mocks.rename, rm: mocks.rm, readFile: mocks.readFile,
}))
import { replaceMacApplication, runLocalBuild } from '../scripts/local-build.ts'

const name = 'DeepSeek Harness Companion'
const installed = `/Applications/${name}.app`

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('npm_execpath', '/fixture/pnpm.cjs')
  vi.stubEnv('COMPANION_MAC_SIGNING_IDENTITY', undefined)
  mocks.execute.mockImplementation(async command => ({ stdout: command === '/usr/bin/security'
    ? '  1) ABCD "Local Test Signing"\n     1 valid identities found' : '', stderr: '' }))
  mocks.mkdtemp.mockResolvedValue('/Applications/.companion-update-fixture')
  mocks.rename.mockResolvedValue(undefined)
  mocks.rm.mockResolvedValue(undefined)
  mocks.readFile.mockImplementation(async (path: string) => path.endsWith('.env.local')
    ? 'COMPANION_MAC_SIGNING_IDENTITY="Local Test Signing"' : '{"version":"0.1.0","build":{"directories":{"output":"dist"}}}')
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('close', 0, null))
    return child
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('Companion local packaging', () => {
  it('prints help without checking certificates, stopping applications, or building', async () => {
    await runLocalBuild(['--help'])
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it.each(['arm64', 'x64'] as const)('updates the %s Mac Companion using the configured local identity', async (arch) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(process, 'arch', 'get').mockReturnValue(arch)
    await runLocalBuild(['update'])
    expect(mocks.spawn.mock.calls[0]?.[1]).toEqual(['/fixture/pnpm.cjs', 'run', 'build'])
    const builder = mocks.spawn.mock.calls[1]?.[1] as string[]
    expect(builder).toContain('--config.mac.identity=Local Test Signing')
    expect(builder).toContain('--config.mac.notarize=false')
    expect(builder).not.toContain('package:desktop')
    const copy = mocks.execute.mock.calls.find(([command]) => command === '/usr/bin/ditto')
    expect(copy?.[1][0]).toContain(join('dist', arch === 'arm64' ? 'mac-arm64' : 'mac', `${name}.app`))
    expect(mocks.execute).toHaveBeenLastCalledWith('/usr/bin/open', [installed])
  })

  it('quits the running Companion before building, without targeting the official application', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    let running = true
    mocks.execute.mockImplementation(async (command) => {
      if (command === '/usr/bin/osascript') running = false
      return { stdout: command === '/usr/bin/security' ? '1) ABCD "Local Test Signing"'
        : command === '/bin/ps' && running ? `${installed}/Contents/MacOS/${name}\n` : '', stderr: '' }
    })
    await runLocalBuild(['update'])
    const quitIndex = mocks.execute.mock.calls.findIndex(([command]) => command === '/usr/bin/osascript')
    expect(mocks.execute.mock.calls[quitIndex]?.[1][1]).toContain(`tell application "${installed}" to quit`)
    expect(mocks.execute.mock.invocationCallOrder[quitIndex]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0]!)
  })

  it('leaves applications alone when the configured signing identity is unavailable', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    mocks.execute.mockResolvedValue({ stdout: '0 valid identities found', stderr: '' })
    await expect(runLocalBuild(['update'])).rejects.toThrow('signing identity is unavailable')
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.execute.mock.calls.some(([command]) => command === '/usr/bin/osascript')).toBe(false)
  })

  it('uses ad-hoc signing when no local identity is configured', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.stubEnv('COMPANION_MAC_SIGNING_IDENTITY', '-')
    await runLocalBuild(['package', 'mac'])
    expect(mocks.spawn.mock.calls[1]?.[1]).toContain('--config.mac.identity=-')
    expect(mocks.execute.mock.calls.some(([command]) => command === '/usr/bin/security')).toBe(false)
    expect(mocks.rename).not.toHaveBeenCalled()
  })

  it('builds and launches the Windows x64 portable Companion on Windows ARM64', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64')
    await runLocalBuild(['update'])
    expect(mocks.execute.mock.calls[0]?.[1].slice(-2)).toEqual(['-Action', 'Stop'])
    expect(mocks.spawn.mock.calls[1]?.[1]).toEqual(['/fixture/pnpm.cjs', 'exec', 'electron-builder', '--publish', 'never', '--win', 'portable', '--x64'])
    expect(mocks.execute.mock.calls.at(-1)?.[1].at(-1)).toContain('deepseek-harness-companion-0.1.0-win-x64.exe')
    expect(mocks.execute.mock.calls.at(-1)?.[1].slice(-4, -1)).toEqual(['-Action', 'Launch', '-Executable'])
  })

  it('does not replace or launch the application after a failed build', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    mocks.spawn.mockImplementation(() => {
      const child = new EventEmitter()
      queueMicrotask(() => child.emit('close', 1, null))
      return child
    })
    await expect(runLocalBuild(['update'])).rejects.toThrow('Companion command failed')
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.execute.mock.calls.some(([command]) => command === '/usr/bin/open')).toBe(false)
  })

  it('refuses installation if signature verification fails', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    mocks.execute.mockImplementation(async (command) => {
      if (command === '/usr/bin/codesign') throw new Error('invalid signature')
      return { stdout: command === '/usr/bin/security' ? '1) ABCD "Local Test Signing"' : '', stderr: '' }
    })
    await expect(runLocalBuild(['update'])).rejects.toThrow('invalid signature')
    expect(mocks.rename).not.toHaveBeenCalled()
  })
})

describe('Companion Mac replacement', () => {
  it('restores the old bundle when promotion fails', async () => {
    mocks.rename.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('promotion failed'))
    await expect(replaceMacApplication('/built.app', installed)).rejects.toThrow('promotion failed')
    expect(mocks.rename).toHaveBeenLastCalledWith(join('/Applications/.companion-update-fixture', 'previous.app'), installed)
  })

  it('retains the backup if restoration also fails', async () => {
    mocks.rename.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('promotion failed'))
      .mockRejectedValueOnce(new Error('restore failed'))
    await expect(replaceMacApplication('/built.app', installed)).rejects.toThrow('restore failed')
    expect(mocks.rm).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('previous.app'))
  })

  it.skipIf(process.platform !== 'darwin')('replaces a real directory and preserves relative symlinks', async () => {
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const childProcess = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const directory = await fs.mkdtemp(join(tmpdir(), 'companion-update-test-'))
    try {
      const source = join(directory, 'built.app')
      const destination = join(directory, 'installed.app')
      await fs.mkdir(source)
      await fs.mkdir(destination)
      await fs.writeFile(join(source, 'payload'), 'new Companion')
      await fs.symlink('payload', join(source, 'alias'))
      await fs.writeFile(join(destination, 'obsolete'), 'old Companion')
      mocks.execute.mockImplementation(promisify(childProcess.execFile))
      mocks.mkdtemp.mockImplementation(fs.mkdtemp)
      mocks.rename.mockImplementation(fs.rename)
      mocks.rm.mockImplementation(fs.rm)
      await replaceMacApplication(source, destination)
      expect(await fs.readFile(join(destination, 'payload'), 'utf8')).toBe('new Companion')
      expect(await fs.readlink(join(destination, 'alias'))).toBe('payload')
      await expect(fs.access(join(destination, 'obsolete'))).rejects.toThrow()
      expect((await fs.readdir(directory)).sort()).toEqual(['built.app', 'installed.app'])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
