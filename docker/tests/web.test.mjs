/** 使用真实构建的 profile 检查远程可信地址和重启后的浏览器 Cookie。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '../..')
const authorities = ['192.0.2.50:3080', 'dsh.example.test']

/** 向回环地址发送请求，同时保留浏览器使用的 Host 和 Origin。 */
function get(port, authority, path = '/', cookie) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, path,
      headers: { host: authority, origin: `${authority.startsWith('192.') ? 'http' : 'https'}://${authority}`, ...(cookie ? { cookie } : {}) },
    }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode, headers: res.headers, body }) })
    })
    req.setTimeout(15_000, () => { req.destroy(new Error('HTTP 冒烟请求超时')) })
    req.on('error', reject)
    req.end()
  })
}

/** 在隔离 home 中启动真实构建的 Web profile，并限制就绪等待和关闭时间。 */
async function start(home, patch, t) {
  const child = spawn(process.execPath, [
    join(root, 'apps/cli/lib/bin.js'), 'web',
    '--patch', join(root, 'apps/web/tests/pin-browse-picker.overlay.yml'), '--patch', patch,
    '--no-open', '--host', '127.0.0.1', '--port', '0',
    ...authorities.flatMap(host => ['--trusted-host', host]),
  ], {
    cwd: home,
    env: { ...process.env, DSH_HOME: join(home, 'home'), DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stderr.on('data', chunk => { diagnostics += chunk })
  const exited = once(child, 'exit')
  let stopping
  const stop = () => stopping ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const kill = setTimeout(() => { child.kill('SIGKILL') }, 10_000)
    try { await exited } finally { clearTimeout(kill) }
  })()
  t.after(stop)
  const lines = createInterface({ input: child.stdout })
  try {
    return await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => { reject(new Error(`等待 Web 就绪超时。 ${diagnostics.slice(-3000)}`)) }, 90_000)
      exited.then(() => { clearTimeout(deadline); reject(new Error(`Web 在就绪前退出。 ${diagnostics.slice(-3000)}`)) }, reject)
      let port
      let startup
      lines.on('line', line => {
        if (line.startsWith('docker-smoke-port: ')) port = Number(line.slice('docker-smoke-port: '.length))
        if (line.startsWith('dsh web: http')) startup = new URL(line.slice('dsh web: '.length))
        if (port && startup) { clearTimeout(deadline); resolve({ port, token: startup.searchParams.get('token'), stop }) }
      })
    })
  } catch (error) {
    await stop()
    throw error
  } finally {
    lines.close()
  }
}

test('进程重启后，局域网与 HTTPS 代理地址分别保留认证会话', { timeout: 180_000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-docker-web-'))
  t.after(async () => { await rm(home, { recursive: true, force: true }) })
  const marker = join(home, 'marker.mjs')
  await writeFile(marker, "export const inject = ['webServer']; export function apply(ctx) { console.log('docker-smoke-port: ' + ctx.webServer.port) }\n")
  const patch = join(home, 'smoke.yml')
  await writeFile(patch, `- insert:\n    - id: docker-smoke-marker\n      name: ${JSON.stringify(pathToFileURL(marker).href)}\n`)
  const first = await start(home, patch, t)
  const cookies = new Map()
  try {
    assert.equal((await get(first.port, 'untrusted.example.test', '/api')).status, 403)
    for (const authority of authorities) {
      assert.equal((await get(first.port, authority, '/api')).status, 401)
      assert.equal((await get(first.port, authority)).status, 401)
      const login = await get(first.port, authority, `/?token=${encodeURIComponent(first.token)}`)
      assert.equal(login.status, 303)
      const cookie = login.headers['set-cookie'][0].split(';')[0]
      cookies.set(authority, cookie)
      assert.equal((await get(first.port, authority, '/', cookie)).status, 200)
    }
    assert.notEqual(cookies.get(authorities[0]), cookies.get(authorities[1]))
    assert.equal((await get(first.port, authorities[1], '/', cookies.get(authorities[0]))).status, 401)
  } finally {
    await first.stop()
  }
  const credentials = await readFile(join(home, 'home/.credentials.yaml'), 'utf8')
  const second = await start(home, patch, t)
  try {
    assert.notEqual(first.token, second.token)
    for (const authority of authorities) {
      assert.equal((await get(second.port, authority, `/?token=${encodeURIComponent(first.token)}`)).status, 401)
      assert.equal((await get(second.port, authority, '/', cookies.get(authority))).status, 200)
    }
    assert.equal(await readFile(join(home, 'home/.credentials.yaml'), 'utf8'), credentials)
  } finally {
    await second.stop()
  }
})
