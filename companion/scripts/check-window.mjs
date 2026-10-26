/** Shipped remote-window check using local fixture pages and an isolated temporary profile. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import ts from 'typescript'
import { isDraggableAt } from '../../packages/client/web/src/window-drag/regions.ts'

const directory = fileURLToPath(new URL('..', import.meta.url))
const lib = process.env.COMPANION_PACKAGED_CHECK === '1'
  ? join(directory, 'dist/win-unpacked/resources/app.asar/lib') : join(directory, 'lib')
const shortcutSource = await readFile(new URL('../../packages/client/shortcuts/src/client/dom.ts', import.meta.url), 'utf8')
const shortcutFile = ts.createSourceFile('dom.ts', shortcutSource, ts.ScriptTarget.Latest)
const detector = shortcutFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'detectEnvironment')
assert.ok(detector)
const detectorScript = ts.transpileModule(detector.getText(shortcutFile), { compilerOptions: { module: ts.ModuleKind.ESNext } })
  .outputText.replace('export ', '')
const root = await mkdtemp(join(tmpdir(), 'companion-chrome-'))
const result = join(root, 'result.json')
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><html lang="en" data-dsh-skin="fixture"><head><style>
  html,body,#root{height:100%;margin:0}
  :root{--dsw-specific-sidebar-fill:#f9fafb;--dsw-alias-label-primary:#0f1115}
  html[data-dsh-skin] body{height:100%!important;margin:0!important;padding:0!important;box-sizing:content-box!important}
  html[data-dsh-skin] #root{height:100%!important}
  [data-caption-control]{position:fixed;top:12px;width:28px;height:28px}
  [data-caption-control="left"]{left:140px}[data-caption-control="right"]{right:12px}
  </style></head><body><div id="root" data-session="retained">
  <header data-window-drag style="height:76px;padding-top:10px;box-sizing:border-box;position:relative"><div data-conversation-header-leading></div><div data-title-row style="height:30px"><button data-caption-control="left">Left sidebar</button><button data-caption-control="right">Right sidebar</button></div><div role="tablist" style="position:absolute;top:50px">Conversation / Trace</div></header>
  <div data-composer-input contenteditable="true">Keep my draft</div></div>${request.url === '/auth' ? '' : '<div aria-hidden="true" data-backdrop style="position:fixed;inset:0;pointer-events:none;z-index:-2"></div><div data-shell-overlay role="dialog"></div>'}</body></html>`)
})
let child
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
  await writeFile(join(root, 'main.mjs'), `
    import {app,dialog,screen} from 'electron';
    import {writeFileSync} from 'node:fs';
    import {openRemoteWindow} from ${JSON.stringify(pathToFileURL(join(lib, 'connection-window.js')).href)};
    import {companionMessages} from ${JSON.stringify(pathToFileURL(join(lib, 'locale.js')).href)};
    import {loadWindowBounds,rememberWindowBounds} from ${JSON.stringify(pathToFileURL(join(lib, 'window-state.js')).href)};
    app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
    dialog.showErrorBox=(title,message)=>{throw new Error(title+': '+message)};
    app.whenReady().then(async()=>{
    let win;let restored;let restoredClosed;
    const loaded=Promise.withResolvers();
    const errors=[];
    const closed=openRemoteWindow(${JSON.stringify(origin + '/auth')},companionMessages('en'),window=>{
      win=window;win.hide();win.webContents.setBackgroundThrottling(false);
      rememberWindowBounds(window,app.getPath('userData'),companionMessages('en'));
      win.webContents.on('preload-error',(_event,_path,error)=>errors.push(String(error)));
      win.webContents.on('did-finish-load',()=>{if(win.webContents.getURL().startsWith(${JSON.stringify(origin)}))loaded.resolve()});
    });
    console.log('remote window created');
    try {
      await loaded.promise;
      console.log('remote page loaded');
      const recovery=win.webContents.listenerCount('context-menu')>0
        && await win.webContents.executeJavaScript('document.querySelector("[data-windows-menu]")===null');
      await win.loadURL(${JSON.stringify(origin + '/ready')});
      win.webContents.send('companion:focus-composer');
      const environment=await win.webContents.executeJavaScript(${JSON.stringify(`${detectorScript}\ndetectEnvironment(document,navigator)`)});
      console.log('shortcut runtime checked');
      const clipboard=await win.webContents.executeJavaScript('(async()=>({write:(await navigator.permissions.query({name:"clipboard-write"})).state,read:(await navigator.permissions.query({name:"clipboard-read"})).state}))()');
      console.log('clipboard checked');
      // The macOS drag watcher pulses no-drag while it collects initial geometry.
      await win.webContents.executeJavaScript('new Promise(resolve=>{let frames=0;requestAnimationFrame(function tick(){if(++frames===4)resolve();else requestAnimationFrame(tick)})})');
      const data=await win.webContents.executeJavaScript(
        '(()=>({regions:Array.from(document.querySelectorAll("*")).flatMap(element=>{const region=getComputedStyle(element).webkitAppRegion;if(region!=="drag"&&region!=="no-drag")return [];const rect=element.getBoundingClientRect();return [{x:rect.x,y:rect.y,width:rect.width,height:rect.height,draggable:region==="drag"}]}),viewportWidth:innerWidth,dragRow:getComputedStyle(document.querySelector("[data-window-drag]")).webkitAppRegion,stripRegion:getComputedStyle(document.querySelector("[data-title-row]")).webkitAppRegion,stripHeight:getComputedStyle(document.querySelector("[data-title-row]")).height,stripTop:document.querySelector("[data-title-row]").getBoundingClientRect().top,backdropRegion:getComputedStyle(document.querySelector("[data-backdrop]")).webkitAppRegion,tabsRegion:getComputedStyle(document.querySelector("[role=tablist]")).webkitAppRegion,portalRegion:getComputedStyle(document.querySelector("[data-shell-overlay]")).webkitAppRegion,clearance:{top:document.getElementById("root").getBoundingClientRect().top,height:document.getElementById("root").getBoundingClientRect().height,viewport:innerHeight},controls:Array.from(document.querySelectorAll("[data-caption-control]")).map(button=>({region:getComputedStyle(button).webkitAppRegion,top:button.getBoundingClientRect().top})),bandContent:getComputedStyle(document.body,"::before").content,platform:document.documentElement.dataset.companionPlatform,desktopMarker:document.documentElement.dataset.platform??null,caption:document.documentElement.hasAttribute("data-windows-titlebar"),menus:Array.from(document.querySelector("[data-windows-menu]")?.shadowRoot.querySelectorAll("button")??[]).map(b=>b.textContent),focused:document.activeElement?.hasAttribute("data-composer-input"),draft:document.querySelector("[data-composer-input]").textContent,session:document.querySelector("[data-session]").dataset.session,node:typeof window.require,host:typeof window.dshDesktop}))()');
      const nativeCaption=win.getContentBounds().y-win.getBounds().y;
      const area=screen.getPrimaryDisplay().workArea;
      win.setBounds({x:area.x,y:area.y,width:Math.max(520,Math.min(900,area.width)),height:Math.max(600,Math.min(700,area.height))});
      const expected=win.getNormalBounds();
      win.close();await closed;
      const saved=loadWindowBounds(app.getPath('userData'),companionMessages('en'));
      restoredClosed=openRemoteWindow(${JSON.stringify(origin + '/ready')},companionMessages('en'),window=>{restored=window;window.hide()},undefined,saved);
      const actual=restored.getNormalBounds();
      writeFileSync(${JSON.stringify(result)},JSON.stringify({data,errors,environment,clipboard,recovery,nativeCaption,windowState:{expected,saved,actual}}));
    } finally {if(!win.isDestroyed())win.destroy();await closed;if(restored&&!restored.isDestroyed())restored.destroy();if(restoredClosed)await restoredClosed;app.quit()}
    }).catch(error=>{console.error(error);app.exit(1)});
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(createRequire(new URL('../package.json', import.meta.url))('electron'), [root], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  child.stdout.on('data', chunk => { diagnostics += chunk.toString() })
  child.stderr.on('data', chunk => { diagnostics += chunk.toString() })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Electron caption check timed out: ${diagnostics}`)) }, 20000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Electron exit ${code}: ${diagnostics}`)) })
  })
  const { data, errors, environment, clipboard, recovery, nativeCaption, windowState } = JSON.parse(await readFile(result, 'utf8'))
  assert.deepEqual(errors, [])
  assert.deepEqual(windowState.actual, windowState.expected)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'profile', 'window-state.json'), 'utf8')), windowState.expected)
  assert.equal(data.platform, process.platform)
  assert.equal(data.desktopMarker, null)
  if (process.platform === 'darwin') {
    assert.deepEqual(data.controls, [{ region: 'no-drag', top: 12 }, { region: 'no-drag', top: 12 }])
    assert.equal(data.bandContent, 'none')
    assert.equal(nativeCaption, 0, 'Embedded caption shares the Web viewport')
    assert.equal(data.dragRow, 'none')
    assert.equal(data.stripRegion, 'drag')
    assert.equal(data.stripHeight, '30px')
    assert.equal(data.stripTop, 10)
    assert.equal(data.backdropRegion, 'none')
    assert.equal(data.tabsRegion, 'none')
    assert.equal(data.portalRegion, 'no-drag')
    assert.equal(isDraggableAt(data.regions, data.viewportWidth / 2, 20), true, 'Title-row blank space drags despite decorative backgrounds')
    assert.equal(isDraggableAt(data.regions, data.viewportWidth / 2, 55), false, 'View-tab row does not drag')
    assert.equal(isDraggableAt(data.regions, data.viewportWidth - 20, 20), false, 'Right-side button remains clickable')
    assert.equal(data.clearance.top, 0)
    assert.equal(data.clearance.height, data.clearance.viewport)
  }
  assert.equal(environment.runtime, 'web')
  assert.equal(recovery, true)
  if (clipboard.write !== 'granted') console.error(diagnostics)
  assert.equal(clipboard.write, 'granted')
  assert.equal(clipboard.read, 'denied')
  if (process.platform === 'win32') { assert.equal(data.caption, true); assert.deepEqual(data.menus, ['Application', 'Edit']) }
  assert.equal(data.focused, true)
  assert.equal(data.draft, 'Keep my draft')
  assert.equal(data.session, 'retained')
  assert.equal(data.node, 'undefined')
  assert.equal(data.host, 'undefined')
  console.log('PASS: shipped remote window, Web shortcut runtime, embedded caption, conversation title-row drag strip, decorative backdrop exclusion, interactive exclusions, unshifted Web layout, persisted window bounds after reopening, clipboard write allowed/read denied, caption/menu, retained conversation/draft and composer focus, no Node or Host API.')
} finally {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve))
    child.kill()
    await closed
  }
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
