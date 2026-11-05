/** 准备挂载的 Linux 源码，再通过官方浏览器认证启动构建后的 CLI。 */
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
 * 标识构建使用的 checkout 与已跟踪改动，同时纳入尚未首次提交的部署脚本。
 * @returns {Promise<string>} 源码和依赖指纹。
 */
export async function sourceFingerprint() {
  const hash = createHash('sha256')
  for (const args of [
    ['rev-parse', 'HEAD'],
    ['diff', '--binary', 'HEAD', '--', 'packages', 'apps', 'vendor', 'native', 'scripts', '*.json', '*.yaml'],
  ]) hash.update(execFileSync('git', ['-c', `safe.directory=${sourceRoot}`, ...args], { cwd: sourceRoot }))
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'docker/run.mjs']) {
    hash.update(file).update(await readFile(join(sourceRoot, file)))
  }
  return hash.digest('hex')
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
  const interrupt = () => { child.kill('SIGINT') }
  const terminate = () => { child.kill('SIGTERM') }
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0 && signal === null) resolve()
        else reject(new Error(`${command} 以${signal ?? `退出码 ${code}`}结束，已停止后续操作。`))
      })
    })
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}

/**
 * 明确执行准备，或运行已验证的构建产物；普通重启不安装依赖或构建。
 * @param {string} action - `prepare` 或 `serve`。
 * @returns {Promise<void>} 准备完成或 Web 进程退出后完成。
 */
export async function main(action) {
  for (const path of [process.env.DSH_HOME, process.env.DSH_AGENTS_HOME, process.env.HOME, process.env.XDG_CACHE_HOME]) {
    if (path) await mkdir(path, { recursive: true })
  }
  switch (action) {
    case 'prepare': {
      await rm(buildRecord, { force: true })
      await run('pnpm', ['install', '--frozen-lockfile'])
      const fingerprint = await sourceFingerprint()
      await run('pnpm', ['--dir', 'native/system', 'run', 'build:native'])
      await run('pnpm', ['run', 'build:artifacts'])
      await run('pnpm', ['run', 'build:check'])
      if (fingerprint !== await sourceFingerprint()) throw new Error('构建期间源码发生变化，请停止编辑后重新执行 prepare。')
      await mkdir(dirname(buildRecord), { recursive: true })
      await writeFile(buildRecord, JSON.stringify({ fingerprint, platform: process.platform, arch: process.arch, node: process.versions.node }) + '\n')
      console.log('DSH 构建完成，请从 Unraid Docker 页面启动已配置的容器。')
      break
    }
    case 'serve': {
      const config = webConfiguration(process.env)
      let record
      try {
        record = JSON.parse(await readFile(buildRecord, 'utf8'))
      } catch (error) {
        throw new Error('找不到可读取的构建记录，请在 Unraid 主机的源码 checkout 中运行 sh docker/prepare.sh dsh。', { cause: error })
      }
      if (record === null || typeof record !== 'object'
        || record.platform !== process.platform || record.arch !== process.arch
        || record.node !== process.versions.node
        || record.fingerprint !== await sourceFingerprint()) {
        throw new Error('源码 checkout 或构建环境已变化，请在 Unraid 主机的源码 checkout 中运行 sh docker/prepare.sh dsh。')
      }
      await run(process.execPath, [
        join(sourceRoot, 'apps/cli/lib/bin.js'), 'web', '--no-open',
        '--host', config.host, '--port', '3080', '--public-url', config.publicUrl,
        ...config.trustedHosts.flatMap(host => ['--trusted-host', host]),
      ], '/workspace')
      break
    }
    default:
      throw new Error('用法：prepare 或 serve（默认）。请在 Unraid 主机运行 docker/prepare.sh，准备已配置的容器。')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2] ?? 'serve').catch(error => {
    console.error(`DSH 容器：${error.message}`)
    process.exitCode = 1
  })
}
