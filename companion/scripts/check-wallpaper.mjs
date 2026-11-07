/** Exercise the shipped preload and wallpaper controller in an isolated real Electron process. */
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
const root = await mkdtemp(join(tmpdir(), 'companion-wallpaper-smoke-'))
const result = join(root, 'result.json')
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><html data-dsh-skin="fixture" data-windows-titlebar><head><style>
    html,body,#root{height:100%;margin:0;background:rgb(255,255,255)}
    body{--surface:white}body[data-ds-dark-theme]{--surface:rgb(21,21,21)}
    .frame{height:100%;display:grid;grid-template-columns:200px 1fr;background:var(--surface)}
    .sidebar,.center,.conversation{height:100%;background:var(--surface)}
    [data-dsh-skin-layer=background]{position:fixed;inset:0;z-index:-2;pointer-events:none}
    .skin-art{position:absolute;inset:0;width:100%;height:100%;background:blue}
    .skin-scrim{position:absolute;left:0;top:0;width:100px;height:100px;background:rgba(0,0,0,.25)}
    .skin-foreground,.drawer{position:fixed;left:40px;top:180px;width:40px;height:40px}
    .skin-foreground{z-index:41;background:blue;pointer-events:none}
    .drawer{z-index:71;background:white}
    [data-dsh-skin]{--dsw-specific-sidebar-fill:rgba(255,255,255,.34)}
    [data-dsh-skin] :is(.frame,.sidebar){background:var(--dsw-specific-sidebar-fill)}
    [role=dialog]{background:var(--surface)}
    </style></head><body><div id="root"><div class="frame">
    <div class="sidebar"><div><header data-window-drag>Sidebar</header></div></div>
    <div class="center"><div><div class="conversation" data-phase="hero"><div data-conversation-content>
    <button>Retained control</button></div></div></div></div><div data-shell-overlay></div>
    </div><div class="drawer"></div></div><div data-dsh-skin-layer="background" aria-hidden="true"><img class="skin-art" alt=""><div class="skin-scrim"></div></div><div class="skin-foreground" aria-hidden="true"></div></body></html>`)
})
let child
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const moduleUrl = name => pathToFileURL(join(lib, name)).href
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
  await writeFile(join(root, 'main.mjs'), `
    import assert from 'node:assert/strict';
    import {mkdir,writeFile,readFile} from 'node:fs/promises';
    import {join} from 'node:path';
    import {app,BrowserWindow,dialog,nativeImage,screen} from 'electron';
    import {installWallpaper} from ${JSON.stringify(moduleUrl('wallpaper.js'))};
    app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
    process.on('uncaughtException',error=>{console.error(error);app.exit(1)});
    app.whenReady().then(async()=>{
      const folder=${JSON.stringify(join(root, 'images'))};await mkdir(folder);await mkdir(app.getPath('userData'),{recursive:true});
      for(const [name,pixel] of [['a.png',[0,0,255,255]],['b.png',[0,255,0,255]]])
        await writeFile(join(folder,name),nativeImage.createFromBitmap(Buffer.from(pixel),{width:1,height:1}).toPNG());
      const empty=${JSON.stringify(join(root,'empty'))};const bad=${JSON.stringify(join(root,'bad'))};await mkdir(empty);await mkdir(bad);await writeFile(join(bad,'broken.png'),'not PNG');
      let choice=folder;let picks=0;
      const mainLayout=JSON.stringify({x:20,y:40,width:1000,height:800});await writeFile(join(app.getPath('userData'),'window-state.json'),mainLayout);
      const errors=[];dialog.showErrorBox=(_title,message)=>errors.push(message);
      dialog.showOpenDialog=async()=>{picks++;return {canceled:false,filePaths:[choice]}};
      const win=new BrowserWindow({width:600,height:600,show:false,webPreferences:{preload:${JSON.stringify(join(lib, 'preload.cjs'))},contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
      const open=installWallpaper(win,${JSON.stringify(origin)});
      const wait=async(expression)=>{for(let n=0;n<200;n++){if(await win.webContents.executeJavaScript(expression))return;await new Promise(resolve=>setTimeout(resolve,25))}throw new Error('Timed out: '+expression+' errors: '+JSON.stringify(errors))};
      const image='document.querySelector("[data-companion-wallpaper-layer] img:last-child")';
      try {
        await win.loadURL(${JSON.stringify(origin)});
        await new Promise(resolve=>setTimeout(resolve,50));
        open();
        const waitSettings=async()=>{for(let n=0;n<200;n++){const candidate=BrowserWindow.getAllWindows().find(other=>other!==win);if(candidate&&!candidate.webContents.isLoading()&&candidate.isVisible()&&candidate.webContents.getURL().startsWith('data:'))return candidate;await new Promise(resolve=>setTimeout(resolve,25))}throw new Error('Settings window did not open')};
        let settings=await waitSettings();
        const submit=async(action)=>{const loaded=new Promise(resolve=>settings.webContents.once('did-finish-load',resolve));await settings.webContents.executeJavaScript('document.querySelector("button[value='+action+']").click()');await loaded};
        await submit('choose');
        assert.equal(await settings.webContents.executeJavaScript('document.querySelector("input[name=dir]").value'),folder);
        assert.equal(await win.webContents.executeJavaScript('document.documentElement.hasAttribute("data-companion-wallpaper")'),false);
        await settings.webContents.executeJavaScript('document.querySelector("input[name=intervalMin]").value=7');
        settings.focus();settings.webContents.focus();
        await settings.webContents.executeJavaScript('document.querySelector("input[name=intervalMin]").focus()');
        const entered=new Promise(resolve=>settings.webContents.once('did-finish-load',resolve));
        settings.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});settings.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});settings.webContents.sendInputEvent({type:'char',keyCode:String.fromCharCode(13)});await entered;
        assert.equal(picks,1,'Enter saves instead of opening the directory picker');
        if(${JSON.stringify(process.env.COMPANION_WALLPAPER_SCREENSHOT??'')}) await writeFile(${JSON.stringify(process.env.COMPANION_WALLPAPER_SCREENSHOT??'')},(await settings.webContents.capturePage()).toPNG());
        await wait(image+'?.complete===true');
        const frameFill=await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".frame")).backgroundColor');
        assert.ok(Math.abs(Number(frameFill.split('/')[1]?.slice(0,-1)) - 0.34) < 0.003,frameFill);
        await win.webContents.executeJavaScript('document.documentElement.style.setProperty("--dsw-specific-sidebar-fill","white")');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".frame")).backgroundColor'),'color(srgb 1 1 1 / 0)');
        await win.webContents.executeJavaScript('document.documentElement.style.removeProperty("--dsw-specific-sidebar-fill")');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".skin-art")).visibility'),'hidden');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".skin-scrim")).visibility'),'visible');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".sidebar")).backgroundColor'),'rgba(255, 255, 255, 0.34)');
        assert.equal(await win.webContents.executeJavaScript('document.documentElement.dataset.dshSkin'),'fixture');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".conversation")).backgroundColor'),'rgba(0, 0, 0, 0)');
        await win.webContents.executeJavaScript('(()=>{const style=document.createElement("style");style.textContent=".conversation{background:white!important}";document.head.append(style);const dialog=document.createElement("div");dialog.setAttribute("role","dialog");dialog.style.cssText="position:fixed;top:80px;left:10px;width:80px;height:40px";document.querySelector("[data-shell-overlay]").append(dialog)})()');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".conversation")).backgroundColor'),'rgba(0, 0, 0, 0)');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector("[role=dialog]")).backgroundColor'),'rgb(255, 255, 255)');
        const first=await win.webContents.executeJavaScript(image+'.src');
        await win.webContents.executeJavaScript('document.documentElement.style.setProperty("--dsw-specific-sidebar-fill","white")');
        await new Promise(resolve=>setTimeout(resolve,1100));
        const pixel=await win.webContents.capturePage();
        await writeFile(${JSON.stringify(join(root, 'wallpaper.png'))},pixel.toPNG());
        if(${JSON.stringify(process.env.COMPANION_WALLPAPER_PAGE_SCREENSHOT??'')}) await writeFile(${JSON.stringify(process.env.COMPANION_WALLPAPER_PAGE_SCREENSHOT??'')},pixel.toPNG());
        const bitmap=pixel.toBitmap();const offset=((Math.floor(pixel.getSize().height/2)*pixel.getSize().width)+Math.floor(pixel.getSize().width/2))*4;
        const center=Array.from(bitmap.subarray(offset,offset+4));
        assert.ok((center[1]>240&&center[2]<60)||(center[2]>240&&center[1]<60),'Wallpaper must be visibly composited: '+center);
        const drawerOffset=(200*pixel.getSize().width+60)*4;
        assert.deepEqual(Array.from(bitmap.subarray(drawerOffset,drawerOffset+4)),[255,255,255,255],'The drawer paints above skin foreground decorations');
        await win.webContents.executeJavaScript('document.body.setAttribute("data-ds-dark-theme", "")');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".conversation")).backgroundColor'),'rgba(0, 0, 0, 0)');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector("[role=dialog]")).backgroundColor'),'rgb(21, 21, 21)');
        if(${JSON.stringify(process.env.COMPANION_WALLPAPER_PAGE_SCREENSHOT??'')}) await writeFile(${JSON.stringify((process.env.COMPANION_WALLPAPER_PAGE_SCREENSHOT??'')+'.dark.png')},(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('document.body.removeAttribute("data-ds-dark-theme")');
        await settings.webContents.executeJavaScript('document.querySelector("input[name=dim]").value=30');
        await settings.webContents.executeJavaScript('document.querySelector("input[name=whiten]").value=40');
        await settings.webContents.executeJavaScript('document.querySelector("input[name=transitionMs]").value=0');
        await submit('save');
        await wait(image+'?.style.filter.includes("0.7")');
        await wait('getComputedStyle('+image+').opacity==="1"');
        const tinted=await win.webContents.capturePage();
        const tintOffset=(Math.floor(tinted.getSize().height/2)*tinted.getSize().width+Math.floor(tinted.getSize().width/2))*4;
        const channels=Array.from(tinted.toBitmap().subarray(tintOffset,tintOffset+3)).sort((a,b)=>a-b);
        assert.ok(channels.every((channel,index)=>Math.abs(channel-[102,102,209][index])<=2),'White overlay must composite over the dimmed image: '+channels);
        await submit('next');
        await wait(image+'?.src!=='+JSON.stringify(first));
        const second=await win.webContents.executeJavaScript(image+'.src');assert.notEqual(first,second);
        await win.loadURL(${JSON.stringify(origin)});await wait(image+'?.src==='+JSON.stringify(second));
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector("[data-companion-wallpaper-layer]"),"::after").backgroundColor'),'rgba(255, 255, 255, 0.4)');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector("[data-companion-wallpaper-layer]")).webkitAppRegion'),'none');
        const previousConfig=await readFile(join(app.getPath('userData'),'wallpaper.json'),'utf8');
        for(const directory of [empty,bad]) {
          choice=directory;await submit('choose');
          const failures=errors.length;
          await submit('save');
          assert.equal(errors.length,failures+1);
          assert.equal(await readFile(join(app.getPath('userData'),'wallpaper.json'),'utf8'),previousConfig);
          assert.equal(await win.webContents.executeJavaScript(image+'.src'),second);
          assert.equal(await settings.webContents.executeJavaScript('document.querySelector("[role=status]").textContent'),'未能完成，请检查错误提示后重试。');
        }
        choice=folder;await submit('choose');
        await settings.webContents.executeJavaScript('document.querySelector("input[name=enabled]").checked=false');
        await submit('save');
        await wait('!document.documentElement.hasAttribute("data-companion-wallpaper")');
        assert.equal(await win.webContents.executeJavaScript('document.body.hasAttribute("data-we-wallpaper")'),false);
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".skin-art")).visibility'),'visible');
        assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor'),'rgb(255, 255, 255)');
        const saved=JSON.parse(await readFile(join(app.getPath('userData'),'wallpaper.json'),'utf8'));assert.equal(saved.enabled,false);assert.equal(saved.dir,folder);assert.equal(saved.intervalMin,7);assert.equal(saved.dim,30);assert.equal(saved.whiten,40);
        assert.equal(errors.length,2);
        const area=screen.getDisplayMatching(win.getBounds()).workArea;
        settings.setBounds({x:area.x+40,y:area.y+40,width:Math.min(760,area.width-80),height:Math.min(750,area.height-80)});
        const layout=settings.getNormalBounds();
        const closed=new Promise(resolve=>settings.once('closed',resolve));settings.close();await closed;
        open();settings=await waitSettings();
        assert.deepEqual(settings.getNormalBounds(),layout);
        const moved=new Promise(resolve=>settings.once('move',resolve));settings.setPosition(layout.x+20,layout.y+20);await moved;
        const forcedLayout=settings.getNormalBounds();settings.destroy();
        assert.deepEqual(JSON.parse(await readFile(join(app.getPath('userData'),'wallpaper-window-state.json'),'utf8')),forcedLayout);
        open();settings=await waitSettings();
        assert.deepEqual(settings.getNormalBounds(),forcedLayout);
        assert.equal(await readFile(join(app.getPath('userData'),'window-state.json'),'utf8'),mainLayout);
        await writeFile(${JSON.stringify(result)},JSON.stringify({ok:true,center}));
      }finally{app.quit()}
    }).catch(error=>{console.error(error);app.exit(1)});
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(createRequire(new URL('../package.json', import.meta.url))('electron'), [root], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(output || 'Wallpaper smoke timed out')) }, 20000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(output)) })
  })
  assert.equal(JSON.parse(await readFile(result, 'utf8')).ok, true)
  console.log('PASS: local configuration dialog, native folder selection, visible image compositing, next image without repeats, reload restoration, decorative drag exclusion, disabling restores original background, persisted settings, rejected empty/corrupt images preserve old preferences and background, Enter saves, settings layout restoration after closing and native destruction, independent main-window layout, no server polling.')
} finally {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed
  }
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true })
}
