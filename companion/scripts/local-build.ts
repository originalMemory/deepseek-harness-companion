/** Package Companion for local use, optionally replacing and reopening the installed client. */
import { execFile, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseEnv, promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const name = 'DeepSeek Harness Companion'
const macApplication = `/Applications/${name}.app`

async function runPnpm(args: readonly string[]): Promise<void> {
  const pnpm = process.env.npm_execpath
  if (!pnpm) throw new Error('Run this command through pnpm.')
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(process.execPath, [pnpm, ...args], { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? resolveRun()
      : reject(new Error(`Companion command failed (${String(code ?? signal)}): pnpm ${args.join(' ')}`)))
  })
}

async function macSigningIdentity(): Promise<string> {
  let settings: NodeJS.Dict<string> = {}
  try { settings = parseEnv(await readFile(join(root, '.env.local'), 'utf8')) } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const identity = (process.env.COMPANION_MAC_SIGNING_IDENTITY ?? settings.COMPANION_MAC_SIGNING_IDENTITY ?? '-').trim()
  if (!identity) throw new Error('COMPANION_MAC_SIGNING_IDENTITY must name a keychain identity, or - for ad-hoc signing.')
  if (identity !== '-') {
    const { stdout } = await execute('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'])
    const identities = stdout.split('\n').filter(line => /^\s*\d+\)/u.test(line))
    if (!identities.some(line => line.includes(`"${identity}"`) || line.trim().split(/\s+/u)[1] === identity)) {
      throw new Error(`Companion signing identity is unavailable: ${identity}. Select an installed identity in companion/.env.local.`)
    }
  }
  return identity
}

async function stopMacApplication(): Promise<void> {
  const executable = `${macApplication}/Contents/MacOS/${name}`
  const running = async () => (await execute('/bin/ps', ['-axww', '-o', 'comm='])).stdout
    .split('\n').some(command => command.trim() === executable)
  if (!await running()) return
  await execute('/usr/bin/osascript', ['-e', `with timeout of 30 seconds\n tell application "${macApplication}" to quit\nend timeout`])
  const deadline = Date.now() + 30_000
  while (await running()) {
    if (Date.now() >= deadline) throw new Error('Companion did not quit within 30 seconds. Quit it from its application or tray menu and retry.')
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
}

/**
 * Stage a complete Mac bundle beside the installed client and restore its backup if promotion fails.
 * @param source - Built Companion bundle.
 * @param destination - Installed Companion bundle.
 * @returns Resolves after promotion; a failed restoration retains and reports the backup.
 */
export async function replaceMacApplication(source: string, destination: string): Promise<void> {
  const staging = await mkdtemp(join(dirname(destination), '.companion-update-'))
  const next = join(staging, 'next.app')
  const previous = join(staging, 'previous.app')
  let backedUp = false
  let preserveBackup = false
  try {
    await execute('/usr/bin/ditto', [source, next])
    try {
      await rename(destination, previous)
      backedUp = true
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    try { await rename(next, destination) } catch (error) {
      if (backedUp) {
        preserveBackup = true
        await rename(previous, destination)
        preserveBackup = false
      }
      throw error
    }
  } finally {
    if (preserveBackup) console.error(`Companion update: restore the previous application from ${previous}`)
    else await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Build only Companion, using local macOS signing and its Windows portable package.
 * @param argv - `package mac`, `package win`, or `update`; --help prints usage.
 * @returns Update resolves after launch is requested; failed checks leave the running client alone.
 */
export async function runLocalBuild(argv: string[]): Promise<void> {
  if (argv.includes('--help')) {
    console.log('Usage: pnpm update:companion\nQuit Companion, package for this machine, update, and reopen it.\nmacOS: /Applications/DeepSeek Harness Companion.app; local keychain identity from companion/.env.local, otherwise ad-hoc.\nWindows: rebuild and launch the portable executable under companion/dist.\nOnly Companion exits; tasks keep running on the remote server.')
    return
  }
  const [mode, requested] = argv
  if ((mode !== 'package' && mode !== 'update') || argv.length !== (mode === 'update' ? 1 : 2)) {
    throw new Error('Expected package mac, package win, or update. Use --help for usage.')
  }
  const platform = mode === 'update' ? process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : undefined : requested
  if (platform !== 'mac' && platform !== 'win') throw new Error('Companion local packaging supports macOS and Windows only.')
  if (platform === 'mac' && process.platform !== 'darwin') throw new Error('Companion macOS signing requires macOS.')
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string; build: { directories: { output: string } }
  }
  const identity = platform === 'mac' ? await macSigningIdentity() : undefined
  const output = join(root, metadata.build.directories.output)
  const application = platform === 'mac'
    ? join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', `${name}.app`)
    : join(output, `deepseek-harness-companion-${metadata.version}-win-x64.exe`)
  const windows = (args: string[]) => execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(root, 'scripts', 'update-windows.ps1'), ...args])
  const stop = () => platform === 'mac' ? stopMacApplication() : windows(['-Action', 'Stop'])
  console.log(`Companion: packaging ${platform}${identity === undefined ? '' : ` with signing identity ${identity}`}`)
  if (mode === 'update') {
    console.log('Companion: quitting the local client; remote server tasks keep running')
    await stop()
  }
  await runPnpm(['run', 'build'])
  await runPnpm(['exec', 'electron-builder', '--publish', 'never', ...(platform === 'mac'
    ? ['--mac', 'zip', `--config.mac.identity=${identity}`, '--config.mac.notarize=false',
      '--config.mac.gatekeeperAssess=false', '--config.mac.timestamp=none', '--config.forceCodeSigning=true']
    : ['--win', 'portable', '--x64'])])
  await access(application)
  if (platform === 'mac') await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', application])
  if (mode !== 'update') return
  await stop()
  if (platform === 'mac') {
    await replaceMacApplication(application, macApplication)
    await execute('/usr/bin/open', [macApplication])
  } else await windows(['-Action', 'Launch', '-Executable', application])
  console.log('Companion: updated and launch requested')
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runLocalBuild(process.argv.slice(2)).catch(error => {
    console.error('Companion:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
