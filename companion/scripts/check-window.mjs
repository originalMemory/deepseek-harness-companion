/** Built Electron caption/preload check using an isolated local page and temporary profile. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const directory = fileURLToPath(new URL('..', import.meta.url))
const lib = process.env.COMPANION_PACKAGED_CHECK === '1'
  ? join(directory, 'dist/win-unpacked/resources/app.asar/lib') : join(directory, 'lib')
const root = await mkdtemp(join(tmpdir(), 'companion-chrome-'))
const result = join(root, 'result.json')
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><html lang="en"><head><style>
  :root{--dsw-specific-sidebar-fill:#f9fafb;--dsw-alias-label-primary:#0f1115}
  </style></head><body><div data-shell-overlay></div><div data-session="retained">
  <div data-composer-input contenteditable="true">Keep my draft</div></div></body></html>`)
})
let child
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
  await writeFile(join(root, 'main.mjs'), `
    import {app,BrowserWindow,dialog} from 'electron';
    import {writeFileSync} from 'node:fs';
    import {remoteWindowChrome,captionPreload,installWindowChrome} from ${JSON.stringify(pathToFileURL(join(lib, 'window-chrome.js')).href)};
    import {companionMessages} from ${JSON.stringify(pathToFileURL(join(lib, 'locale.js')).href)};
    app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
    dialog.showErrorBox=(title,message)=>{throw new Error(title+': '+message)};
    app.whenReady().then(async()=>{
    const win=new BrowserWindow({...remoteWindowChrome(),show:false,webPreferences:{preload:captionPreload,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const errors=[];
    win.webContents.on('preload-error',(_event,_path,error)=>errors.push(String(error)));
    installWindowChrome(win,${JSON.stringify(origin)},companionMessages('en'),()=>{});
    try {
      await win.loadURL(${JSON.stringify(origin)});
      win.webContents.send('companion:focus-composer');
      const data=await win.webContents.executeJavaScript(
        '(async()=>{await new Promise(resolve=>requestAnimationFrame(resolve));return {platform:document.documentElement.dataset.platform,caption:document.documentElement.hasAttribute("data-windows-titlebar"),menus:Array.from(document.querySelector("[data-windows-menu]")?.shadowRoot.querySelectorAll("button")??[]).map(b=>b.textContent),focused:document.activeElement?.hasAttribute("data-composer-input"),draft:document.querySelector("[data-composer-input]").textContent,session:document.querySelector("[data-session]").dataset.session,node:typeof window.require,host:typeof window.dshDesktop}})()');
      writeFileSync(${JSON.stringify(result)},JSON.stringify({data,errors}));
    } finally {win.destroy();app.quit()}
    }).catch(error=>{console.error(error);app.exit(1)});
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(createRequire(new URL('../package.json', import.meta.url))('electron'), [root], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stderr.on('data', chunk => { diagnostics += chunk.toString() })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Electron caption check timed out: ${diagnostics}`)) }, 20000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Electron exit ${code}: ${diagnostics}`)) })
  })
  const { data, errors } = JSON.parse(await readFile(result, 'utf8'))
  assert.deepEqual(errors, [])
  assert.equal(data.platform, process.platform)
  if (process.platform === 'win32') { assert.equal(data.caption, true); assert.deepEqual(data.menus, ['Application', 'Edit']) }
  assert.equal(data.focused, true)
  assert.equal(data.draft, 'Keep my draft')
  assert.equal(data.session, 'retained')
  assert.equal(data.node, 'undefined')
  assert.equal(data.host, 'undefined')
  console.log('PASS: isolated official caption, menu labels, composer focus, retained conversation/draft, no renderer Node or Host API.')
} finally {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve))
    child.kill()
    await closed
  }
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
