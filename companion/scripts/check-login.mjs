/** 使用隔离测试服务验证构建后的 Electron 窗口状态恢复与持久 Cookie 登录。 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const directory = join(import.meta.dirname, '..')
const root = await mkdtemp(join(tmpdir(), 'companion-login-'))
const server = createServer((request, response) => {
  if (request.url === '/?token=fixture') {
    response.writeHead(303, { location: '/', 'set-cookie': 'fixture-auth=owner; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400' })
  } else if (request.url === '/forbidden') response.writeHead(403)
  else response.writeHead(request.headers.cookie?.includes('fixture-auth=owner') ? 200 : 401)
  response.end('<!doctype html><html><body>Companion login fixture</body></html>')
})
let child
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
  await writeFile(join(root, 'main.mjs'), `
    import assert from 'node:assert/strict';
    import {app,dialog,session} from 'electron';
    import {openRemoteWindow} from ${JSON.stringify(pathToFileURL(join(directory, 'lib/connection-window.js')).href)};
    import {companionMessages} from ${JSON.stringify(pathToFileURL(join(directory, 'lib/locale.js')).href)};
    app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
    app.on('window-all-closed',()=>{});
    const messages=companionMessages('en');
    const dialogs=[];
    let trustAttempts=0;
    const hide=window=>window.hide();
    dialog.showMessageBox=async(_window,options)=>{
      dialogs.push(options);
      if(options.message!==messages.authenticationFailed&&options.message!==messages.trustFailed) {
        console.error('意外的错误提示：'+options.message);
        return {response:1};
      }
      return {response:options.message===messages.authenticationFailed?0:(trustAttempts++===0?0:1)};
    };
    dialog.showErrorBox=(_title,message)=>{throw new Error(message)};
    app.whenReady().then(async()=>{
      assert.equal(await openRemoteWindow(${JSON.stringify(origin)},messages,hide),'change');
      assert.equal(dialogs[0].message,messages.authenticationFailed);
      async function visit(url){
        let win;
        const ready=Promise.withResolvers();
        const closed=openRemoteWindow(url,messages,window=>{
          win=window;hide(window);
          window.webContents.on('did-finish-load',()=>{if(window.webContents.getURL()===${JSON.stringify(origin + '/')})ready.resolve()});
        });
        try {
          await Promise.race([ready.promise,closed.then(()=>{throw new Error('认证页面加载完成前窗口已关闭')})]);
          const cookies=await session.fromPartition('persist:companion').cookies.get({url:${JSON.stringify(origin)}});
          assert.equal(cookies.find(cookie=>cookie.name==='fixture-auth')?.session,false);
        } finally {if(!win.isDestroyed())win.destroy();await closed}
      }
      await visit(${JSON.stringify(origin + '/?token=fixture')});
      await visit(${JSON.stringify(origin + '/')});
      assert.equal(dialogs.length,1);
      assert.equal(await openRemoteWindow(${JSON.stringify(origin + '/forbidden')},messages,hide),'change');
      assert.equal(dialogs.length,3);
      assert.equal(dialogs[1].message,messages.trustFailed);
      assert.equal(dialogs[2].message,messages.trustFailed);
      console.log('通过：真实 Electron 主框架的 401/403 恢复、403 重试、token 重定向，以及不携带 token 时复用持久 Cookie。');
      app.quit();
    }).catch(error=>{console.error(error);app.exit(1)});
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(createRequire(new URL('../package.json', import.meta.url))('electron'), [root], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let diagnostics = ''
  child.stdout.on('data', chunk => { diagnostics += chunk })
  child.stderr.on('data', chunk => { diagnostics += chunk })
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { child.kill(); reject(new Error(`Electron 登录检查超时： ${diagnostics}`)) }, 30_000)
    child.once('error', error => { clearTimeout(deadline); reject(error) })
    child.once('close', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error(`Electron 登录检查退出码 ${code}： ${diagnostics}`)) })
  })
  const passed = diagnostics.split('\n').find(line => line.startsWith('通过：'))
  assert.ok(passed, `Electron 在登录检查完成前退出： ${diagnostics}`)
  console.log(passed)
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve))
    child.kill()
    await closed
  }
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
