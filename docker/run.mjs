/** 准备挂载的 Linux 源码，再通过官方浏览器认证启动构建后的 CLI。 */
import { spawn, execFileSync } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sourceRoot = resolve(import.meta.dirname, '..')
const buildRecord = join(sourceRoot, 'node_modules', '.dsh-docker-build.json')

/**
 * 解析容器的具体监听地址和浏览器访问地址，不根据转发头推断信任。
 * @param {NodeJS.ProcessEnv} env - 部署环境。
 * @param {ReturnType<typeof networkInterfaces>} interfaces - 容器可用的网络地址。
 * @returns {{ host: string, publicUrl: string, trustedHosts: string[] }} 明确的 Web 启动配置。
 */
export function webConfiguration(env, interfaces = networkInterfaces()) {
  if (!env.DSH_PUBLIC_URL) throw new Error('请在 Unraid 容器配置中将 DSH_PUBLIC_URL 设置为浏览器使用的局域网或 Lucky URL。')
  let url
  try { url = new URL(env.DSH_PUBLIC_URL) } catch (error) {
    throw new Error('DSH_PUBLIC_URL 不是有效的 HTTP(S) URL。', { cause: error })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('DSH_PUBLIC_URL 必须是 HTTP(S) 根地址，不能包含用户名、密码、路径前缀、查询参数或片段。')
  }
  const host = env.DSH_BIND_HOST || Object.values(interfaces).flat().find(
    address => address?.family === 'IPv4' && !address.internal,
  )?.address
  if (!host || !isIP(host) || host === '0.0.0.0' || host === '::') {
    throw new Error('找不到具体监听 IP，请将 DSH_BIND_HOST 设置为分配给容器的一个 IP 地址。')
  }
  const trustedHosts = [...new Set([
    url.host,
    ...(env.DSH_TRUSTED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean),
  ])]
  return { host, publicUrl: url.href, trustedHosts }
}

/**
 * 读取 checkout 提交；未提交修改需要显式 prepare。
 * @returns {string} 完整 Git 提交哈希。
 */
export function sourceCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
}

/**
 * 运行一个子进程，转发关闭信号并保留失败状态。
 * @param {string} command - 待运行的可执行程序。
 * @param {string[]} args - 原样传递的程序参数。
 * @param {string} cwd - 子进程工作目录。
 * @returns {Promise<void>} 仅在子进程成功退出后完成。
 */
async function run(command, args, cwd = sourceRoot) {
  const child = spawn(command, args, { cwd, stdio: 'inherit' })
  let interrupted
  const interrupt = () => { interrupted = 'SIGINT'; child.kill('SIGINT') }
  const terminate = () => { interrupted = 'SIGTERM'; child.kill('SIGTERM') }
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0 && signal === null && !interrupted) resolve()
        else reject(new Error(`${command} 以${interrupted ?? signal ?? `退出码 ${code}`}结束，已停止后续操作。`))
      })
    })
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}

/**
 * 检查构建记录、运行环境、源码及主要产物；读取权限错误直接报错。
 * @returns {Promise<boolean>} 当前源码可直接运行时为 true，否则需要重新准备。
 */
export async function buildIsCurrent() {
  let record
  try {
    record = JSON.parse(await readFile(buildRecord, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false
    throw error
  }
  if (record === null || typeof record !== 'object'
    || record.platform !== process.platform || record.arch !== process.arch
    || record.node !== process.versions.node
    || record.commit !== sourceCommit()) return false
  for (const file of ['apps/cli/lib/bin.js', 'apps/web/dist/index.html', 'node_modules/.pnpm/lock.yaml']) {
    try { await access(join(sourceRoot, file)) } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }
  return true
}

/** 安装和构建全部成功、且提交未变化时才写入构建记录；失败后禁止使用旧记录。 */
async function prepare() {
  await rm(buildRecord, { force: true })
  const commit = sourceCommit()
  await run('pnpm', ['install', '--frozen-lockfile', '--force'])
  await run('pnpm', ['--dir', 'native/system', 'run', 'build:native'])
  await run('pnpm', ['run', 'build:artifacts'])
  await run('pnpm', ['run', 'build:check'])
  if (commit !== sourceCommit()) throw new Error('构建期间源码提交发生变化，请停止更新后重新启动或执行 prepare。')
  await mkdir(dirname(buildRecord), { recursive: true })
  await writeFile(buildRecord, JSON.stringify({ commit, platform: process.platform, arch: process.arch, node: process.versions.node }) + '\n')
  console.log('DSH 构建完成。')
}

/**
 * 启动前按需准备，或明确强制准备；失败时停止，不启动 Web。
 * @param {string} action - `prepare` 或 `serve`。
 * @returns {Promise<void>} 准备完成或 Web 进程退出后完成。
 */
export async function main(action) {
  for (const path of [process.env.DSH_HOME, process.env.DSH_AGENTS_HOME, process.env.HOME, process.env.XDG_CACHE_HOME]) {
    if (path) await mkdir(path, { recursive: true })
  }
  switch (action) {
    case 'prepare': {
      await prepare()
      break
    }
    case 'serve': {
      const config = webConfiguration(process.env)
      if (!await buildIsCurrent()) {
        console.log('DSH 构建缺失或已变化，自动准备应用。')
        await prepare()
      } else {
        console.log('DSH 构建已是最新，直接启动。')
      }
      await run(process.execPath, [
        join(sourceRoot, 'apps/cli/lib/bin.js'), 'web', '--no-open',
        '--host', config.host, '--port', '3080', '--public-url', config.publicUrl,
        ...config.trustedHosts.flatMap(host => ['--trusted-host', host]),
      ], '/workspace')
      break
    }
    default:
      throw new Error('用法：prepare（强制准备）或 serve（默认，按需自动准备）。')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2] ?? 'serve').catch(error => {
    console.error(`DSH 容器：${error.message}`)
    process.exitCode = 1
  })
}
