/** 宿主维护复用已配置的 Docker 参数，不保留临时环境文件。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const execute = promisify(execFile)
const script = resolve(import.meta.dirname, '../prepare.sh')

for (const failure of ['none', 'build', 'mount']) {
  const scenario = { none: '成功', build: '构建失败', mount: '挂载缺失' }[failure]
  test(`准备场景（${scenario}）清理临时配置并保留手动启动控制`, {
    skip: process.platform === 'win32' && 'Unraid 宿主准备脚本需要 POSIX shell',
  }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh prepare '))
    t.after(async () => { await rm(root, { recursive: true, force: true }) })
    const log = join(root, 'calls.jsonl')
    await writeFile(join(root, 'docker'), `#!/usr/bin/env node
const fs = require('node:fs');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'inspect') {
  const format = args[args.indexOf('--format') + 1];
  if (format.includes('.Config.Env')) console.log('DSH_HOME=/data/dsh\\nDSH_FIXTURE=value with spaces');
  else if (format.includes('.Image')) console.log('sha256:fixture-image');
  else if (format.includes('.Config.User')) console.log('99:100');
  else if (format.includes('.Mounts')) console.log('/opt/dsh\\n/opt/dsh/node_modules\\n/pnpm/store\\n/workspace' + (process.env.DOCKER_TEST_FAILURE === 'mount' ? '' : '\\n/data'));
} else if (args[0] === 'run') {
  const file = args[args.indexOf('--env-file') + 1];
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(fs.readFileSync(file, 'utf8').includes('DSH_FIXTURE=value with spaces'));
  assert.deepEqual(args.slice(-2), ['sha256:fixture-image', 'prepare']);
  process.exit(process.env.DOCKER_TEST_FAILURE === 'build' ? 17 : 0);
}
`, { mode: 0o755 })
    const command = execute('sh', [script, 'dsh'], {
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TMPDIR: root, DOCKER_TEST_LOG: log, DOCKER_TEST_FAILURE: failure },
    })
    if (failure !== 'none') await assert.rejects(command, error => error.code === (failure === 'build' ? 17 : 1))
    else assert.match((await command).stdout, /构建完成/)
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual((await readdir(root)).sort(), ['calls.jsonl', 'docker'])
    if (failure === 'mount') {
      assert.equal(calls.some(args => ['stop', 'run', 'start'].includes(args[0])), false)
      return
    }
    assert.ok(calls.findIndex(args => args[0] === 'stop') < calls.findIndex(args => args[0] === 'run'))
    assert.equal(calls.some(args => args[0] === 'start'), false)
    const run = calls.find(args => args[0] === 'run')
    assert.equal(run[run.indexOf('--volumes-from') + 1], 'dsh')
    assert.equal(run[run.indexOf('--user') + 1], '99:100')
    assert.ok(run.includes('--pull=never'))
    await assert.rejects(access(run[run.indexOf('--env-file') + 1]), { code: 'ENOENT' })
  })
}
