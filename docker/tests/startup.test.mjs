/** 在独立 checkout 中验证自动准备，只替换依赖安装和编译命令。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execute = promisify(execFile)

test('启动按需准备，重启复用产物，失败后不启动 Web', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh startup '))
  t.after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 3 }) })
  await mkdir(join(root, 'docker'))
  await mkdir(join(root, 'apps'))
  await mkdir(join(root, 'workspace'))
  await writeFile(join(root, 'docker/run.mjs'), await readFile(new URL('../run.mjs', import.meta.url)))
  await writeFile(join(root, 'package.json'), '{"private":true}\n')
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
  await writeFile(join(root, 'apps/example.ts'), 'export const value = 1\n')
  await writeFile(join(root, '.gitignore'), 'node_modules/\napps/cli/lib/\napps/web/dist/\ntrace.jsonl\nuser/\ncache/\ndsh/\n')
  const git = (...args) => execute('git', args, { cwd: root })
  await git('init')
  await git('config', 'core.autocrlf', 'false')
  await git('add', '.')
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture')
  await writeFile(join(root, 'driver.mjs'), `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (command !== 'pnpm') return spawn(command, args, { ...options, cwd: process.env.FIXTURE_WORKSPACE });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./pnpm.mjs', import.meta.url)), ...args], {
    ...options, ...(process.env.FIXTURE_STOP ? { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] } : {}),
  });
  if (process.env.FIXTURE_STOP) {
    child.kill = signal => { child.send(signal); return true; };
    child.once('message', () => process.emit('SIGTERM'));
  }
  return child;
};
syncBuiltinESMExports();
const { main } = await import('./docker/run.mjs');
try { await main(process.argv[2]); } catch (error) { console.error(error); process.exitCode = 1; }
`)
  await writeFile(join(root, 'pnpm.mjs'), `
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
await appendFile(process.env.FIXTURE_TRACE, JSON.stringify(args) + '\\n');
if (process.env.FIXTURE_STOP) {
  process.on('message', () => process.exit(0));
  process.send('ready');
  await new Promise(() => {});
}
if (args.includes(process.env.FIXTURE_FAIL)) process.exit(17);
if (args.includes('build:artifacts')) {
  for (const [file, content] of [
    ['apps/cli/lib/bin.js', "require('node:fs').appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify(['web', ...process.argv.slice(2)]) + '\\\\n')"],
    ['apps/web/dist/index.html', '<html></html>'],
    ['node_modules/.pnpm/lock.yaml', 'lockfileVersion: 9'],
  ]) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, content); }
}
if (process.env.FIXTURE_MUTATE && args.includes('build:check')) {
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'concurrent update']);
}
`)
  const trace = join(root, 'trace.jsonl')
  const record = join(root, 'node_modules/.dsh-docker-build.json')
  const start = async (extra = {}, action = 'serve') => {
    await writeFile(trace, '')
    return execute(process.execPath, [join(root, 'driver.mjs'), action], {
      cwd: root,
      timeout: 60_000,
      env: {
        ...process.env, DSH_PUBLIC_URL: 'http://192.0.2.50:3080', DSH_BIND_HOST: '127.0.0.1',
        DSH_HOME: join(root, 'dsh'), DSH_AGENTS_HOME: join(root, 'dsh/agents'),
        HOME: join(root, 'user'), XDG_CACHE_HOME: join(root, 'cache'),
        FIXTURE_TRACE: trace, FIXTURE_WORKSPACE: join(root, 'workspace'), ...extra,
      },
    })
  }
  const calls = async () => (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  const prepared = async () => {
    const entries = await calls()
    assert.deepEqual(entries.slice(0, 4), [
      ['install', '--frozen-lockfile', '--force'], ['--dir', 'native/system', 'run', 'build:native'],
      ['run', 'build:artifacts'], ['run', 'build:check'],
    ])
    assert.equal(entries[4][0], 'web')
    assert.equal(entries.length, 5)
    await access(record)
  }

  await t.test('首次启动自动准备，普通重启只启动 Web', async () => {
    assert.match((await start()).stdout, /自动准备应用/)
    await prepared()
    assert.match((await start()).stdout, /直接启动/)
    assert.equal((await calls()).length, 1)
    assert.equal((await calls())[0][0], 'web')
  })
  await t.test('未提交修改不触发准备，新提交触发准备', async () => {
    await appendFile(join(root, 'apps/example.ts'), '// tracked edit\n')
    await start()
    assert.equal((await calls()).length, 1)
    await writeFile(join(root, 'apps/new.ts'), 'export const added = true\n')
    await start()
    assert.equal((await calls()).length, 1)
    await git('add', 'apps')
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'update')
    await start()
    await prepared()
  })
  await t.test('损坏记录、不兼容运行环境和缺失产物触发准备', async () => {
    for (const invalid of ['{', 'null']) {
      await writeFile(record, invalid)
      await start()
      await prepared()
    }
    for (const key of ['platform', 'arch', 'node']) {
      const current = JSON.parse(await readFile(record, 'utf8'))
      await writeFile(record, JSON.stringify({ ...current, [key]: 'incompatible' }))
      await start()
      await prepared()
    }
    await rm(join(root, 'apps/web/dist/index.html'))
    await start()
    await prepared()
  })
  await t.test('安装或编译失败清除记录、不启动，下次可重新准备', async () => {
    for (const stage of ['install', 'build:native', 'build:artifacts', 'build:check']) {
      await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', `rebuild before ${stage}`)
      await assert.rejects(start({ FIXTURE_FAIL: stage }), error => error.code === 1 && error.signal === null)
      await assert.rejects(access(record), { code: 'ENOENT' })
      assert.equal((await calls()).some(args => args[0] === 'web'), false)
      await start()
      await prepared()
    }
  })
  await t.test('构建中提交变化时不记录成功、不启动 Web', async () => {
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'rebuild before concurrent update')
    await assert.rejects(start({ FIXTURE_MUTATE: '1' }), error => error.code === 1 && error.signal === null)
    await assert.rejects(access(record), { code: 'ENOENT' })
    assert.equal((await calls()).some(args => args[0] === 'web'), false)
    await start()
    await prepared()
  })
  await t.test('显式 prepare 强制重建，错误 URL 在安装前失败', async () => {
    await start({}, 'prepare')
    assert.equal((await calls()).length, 4)
    await assert.rejects(start({ DSH_PUBLIC_URL: 'file:///invalid' }), error => error.code === 1 && error.signal === null)
    assert.deepEqual(await calls(), [])
  })
  await t.test('收到停止信号后，即使子进程退出成功也不继续构建', async () => {
    await assert.rejects(start({ FIXTURE_STOP: '1' }, 'prepare'), error =>
      error.code === 1 && error.signal === null && /SIGTERM/.test(error.stderr))
    assert.equal((await calls()).length, 1)
    await assert.rejects(access(record), { code: 'ENOENT' })
  })
})
