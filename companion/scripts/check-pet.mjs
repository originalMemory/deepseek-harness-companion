/** Real Electron IPC/window check with local fixture pages; does not qualify OS pixel hit testing or Live2D performance. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const directory = fileURLToPath(new URL('..', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'companion-pet-check-'))
const result = join(root, 'result.json')
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html')
  if (request.url === '/api/dsh-companion/avatar/pet') {
    response.end(`<!doctype html><html><head><style>
      html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
      #companion-pet-stage{position:absolute;inset:160px 0 0}
      #fixture-model{position:absolute;left:20%;top:10%;width:60%;height:80%;background:#def}
      .dsh-avatar-bubble{position:absolute;box-sizing:border-box;width:340px;padding:12px 14px;display:flex;flex-direction:column;font:14px/1.5 sans-serif;background:white}
      .dsh-avatar-bubble[hidden]{display:none}.dsh-avatar-bubble-text{overflow:auto;min-height:0}
    </style></head><body><div id="companion-pet-stage"><div id="fixture-model"></div></div>
    <section class="dsh-avatar-bubble" hidden><div>Notification</div><div class="dsh-avatar-bubble-text"></div></section><script>
      let visible=true,bubble=null,modelReady=false;
      window.controls=[];window.wheels=0;window.lastWheelDelta=0;document.addEventListener('wheel',event=>{window.wheels++;window.lastWheelDelta=event.deltaY});
      const stage=document.getElementById('companion-pet-stage'),panel=document.querySelector('.dsh-avatar-bubble'),text=document.querySelector('.dsh-avatar-bubble-text');
      const anchor=()=>{const r=stage.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.085}};
      const layout=()=>{const a=anchor();panel.style.left=(a.x-170)+'px';panel.style.maxHeight=Math.max(72,a.y-20)+'px';panel.style.top=(a.y-12-panel.getBoundingClientRect().height)+'px';panel.style.visibility=a.y>=92?'visible':'hidden'};
      new ResizeObserver(layout).observe(stage);window.addEventListener('resize',layout);
      requestAnimationFrame(function frame(){if(bubble!==null)layout();requestAnimationFrame(frame)});
      const emit=detail=>window.dispatchEvent(new CustomEvent('dsh-companion:pet-event',{detail}));
      window.dshCompanionPet={version:1,getState:()=>({version:1,ready:modelReady,visible,bubbleVisible:bubble!==null&&panel.style.visibility==='visible',headAnchor:anchor(),bounds:{left:.2,top:.1,right:.8,bottom:.9}}),
        hitTest:(x,y)=>{const r=document.getElementById('fixture-model').getBoundingClientRect();return {hit:x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom,region:'body'}}};
      window.addEventListener('message',event=>{
        if(event.source!==window||event.origin!==location.origin)return;
        window.controls.push(event.data);
        if(event.data.type==='visibility'){visible=event.data.visible;if(!visible){bubble=null;panel.hidden=true}}
        if(event.data.type==='bubble:show'){bubble=event.data.bubble;text.textContent=bubble.text;panel.hidden=false;layout()}
      });
      window.fixture={ready:()=>{modelReady=true;emit({type:'model-ready',version:1})},
        click:()=>emit({type:'bubble-click',sessionId:'other'}),bubble:()=>bubble};
      emit({type:'ready',version:1});
    </script></body></html>`)
  } else {
    response.end(`<!doctype html><html><head><script>
      window.initialHost=document.documentElement.dataset.companionAvatarHost;
      window.hosts=[];window.addEventListener('message',event=>{
        if(event.source===window&&event.origin===location.origin&&event.data.type==='host')window.hosts.push(event.data.host);
      });
    </script></head><body><div id="root"><div data-composer-input contenteditable="true">retained draft</div></div></body></html>`)
  }
})
let child
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const moduleUrl = file => pathToFileURL(join(directory, 'lib', file)).href
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', main: 'main.mjs' }))
  await writeFile(join(root, 'main.mjs'), `
    import assert from 'node:assert/strict';
    import {app,BrowserWindow,dialog,ipcMain,Menu,Notification,screen} from 'electron';
    import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
    import {join} from 'node:path';
    import {openRemoteWindow} from ${JSON.stringify(moduleUrl('connection-window.js'))};
    import {companionMessages} from ${JSON.stringify(moduleUrl('locale.js'))};
    app.setPath('userData',${JSON.stringify(join(root, 'profile'))});
    mkdirSync(app.getPath('userData'),{recursive:true});
    writeFileSync(join(app.getPath('userData'),'pet-settings.json'),JSON.stringify({enabled:true}));
    const errors=[];dialog.showErrorBox=(title,message)=>errors.push({title,message});
    const wait=async(predicate)=>{const deadline=Date.now()+8000;while(!await predicate()){
      if(Date.now()>deadline)throw new Error('Pet state timed out');await new Promise(resolve=>setTimeout(resolve,30))}};
    app.whenReady().then(async()=>{
      let gui;const preloadErrors=[];let petToggle,petReset,resetSize;let unread=0,toasts=0;
      const loaded=Promise.withResolvers();
      const build=Menu.buildFromTemplate;
      Menu.buildFromTemplate=function(items){
        petToggle=items.find(item=>item.label===companionMessages('en').showPet)??petToggle;
        petReset=items.find(item=>item.label===companionMessages('en').resetPetPosition)??petReset;
        resetSize=items.find(item=>item.label===companionMessages('en').petResetScale)??resetSize;
        return build.call(this,items);
      };
      Menu.prototype.popup=function(options){options?.callback?.()};
      Notification.prototype.show=function(){toasts++};
      const closed=openRemoteWindow(${JSON.stringify(origin)},companionMessages('en'),window=>{
        gui=window;
        gui.webContents.on('preload-error',(_event,_path,error)=>preloadErrors.push(String(error)));
        gui.webContents.on('did-finish-load',()=>{if(gui.webContents.getURL()===${JSON.stringify(origin + '/')})loaded.resolve()});
      },{available:false,setRunning(){},setFocused(){},markUnread(){unread++},setPetItems(){}},undefined,app.getPath('userData'));
      const cdp=(method,value)=>gui.webContents.debugger.emit('message',{},method,value);
      const item=value=>cdp('Network.webSocketFrameReceived',{requestId:'fixture',response:{opcode:1,payloadData:JSON.stringify({type:'item',streamId:'follow',value})}});
      const complete=(turn,text)=>{
        item({type:'event',event:{type:'turn/start',data:{turn}}});
        item({type:'event',event:{type:'assistant/message',data:{turn,message:{content:[{type:'text',text}]}}}});
        item({type:'event',event:{type:'turn/end',data:{turn,reason:{kind:'completed'}}}});
      };
      try {
        await loaded.promise;
        assert.equal(await gui.webContents.executeJavaScript('window.initialHost'),'web');
        cdp('Network.webSocketCreated',{requestId:'fixture',url:${JSON.stringify(origin.replace('http:', 'ws:') + '/api/remote.mux')}});
        cdp('Network.webSocketFrameSent',{requestId:'fixture',response:{opcode:1,payloadData:JSON.stringify({type:'open',streamId:'follow',endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId:'other'}}}}})}});
        item({type:'event',event:{type:'turn/start',data:{turn:1}}});
        const pet=BrowserWindow.getAllWindows().find(window=>window!==gui);
        assert.ok(pet);pet.webContents.on('preload-error',(_event,_path,error)=>preloadErrors.push(String(error)));
        await wait(()=>pet.webContents.executeJavaScript('!!window.fixture'));
        assert.equal(pet.webContents.session,gui.webContents.session);
        assert.equal(pet.isVisible(),false);
        await pet.webContents.executeJavaScript('window.fixture.ready()');
        await wait(async()=>pet.isVisible()&&await gui.webContents.executeJavaScript('document.documentElement.dataset.companionAvatarHost==="desktop"'));
        const target=screen.getAllDisplays().find(display=>display.id!==screen.getPrimaryDisplay().id)??screen.getPrimaryDisplay();
        gui.setBounds({x:target.workArea.x+10,y:target.workArea.y+10,width:Math.min(900,target.workArea.width-20),height:Math.min(700,target.workArea.height-20)});
        gui.emit('system-context-menu',{preventDefault(){}});assert.ok(petReset);petReset.click();
        const area=screen.getDisplayMatching(gui.getBounds()).workArea;
        const expectedWidth=240,expectedHeight=440;
        assert.deepEqual(pet.getContentBounds(),{x:area.x+area.width-expectedWidth,y:area.y+area.height-expectedHeight,width:expectedWidth,height:expectedHeight});
        await gui.webContents.executeJavaScript('location.reload();undefined');
        await wait(()=>gui.webContents.executeJavaScript('window.initialHost==="desktop"'));
        assert.equal(await gui.webContents.executeJavaScript('window.initialHost'),'desktop','host marked before first page script');
        // Reload resets the observer baseline; establish a new fixture stream before the live completion.
        cdp('Network.webSocketCreated',{requestId:'fixture',url:${JSON.stringify(origin.replace('http:', 'ws:') + '/api/remote.mux')}});
        cdp('Network.webSocketFrameSent',{requestId:'fixture',response:{opcode:1,payloadData:JSON.stringify({type:'open',streamId:'follow',endpoint:'session/follow',payload:{args:{request:{address:{kind:'session',sessionId:'other'}}}}})}});
        gui.hide();complete(2,'Plain completion');
        await wait(()=>pet.webContents.executeJavaScript('window.fixture.bubble()?.text==="Plain completion"'));
        await wait(()=>pet.webContents.executeJavaScript('window.dshCompanionPet.getState().bubbleVisible'));
        const bubbleMetrics=()=>pet.webContents.executeJavaScript('({width:document.querySelector(".dsh-avatar-bubble").getBoundingClientRect().width,font:getComputedStyle(document.querySelector(".dsh-avatar-bubble-text")).fontSize,model:document.getElementById("companion-pet-stage").getBoundingClientRect().width})');
        const beforeScale=await bubbleMetrics();
        const margins=()=>pet.webContents.executeJavaScript('(()=>{const b=document.querySelector(".dsh-avatar-bubble").getBoundingClientRect(),m=document.getElementById("fixture-model").getBoundingClientRect();return {left:Math.min(b.left,m.left),right:innerWidth-Math.max(b.right,m.right),top:Math.min(b.top,m.top),bottom:innerHeight-Math.max(b.bottom,m.bottom)}})()');
        for(const value of Object.values(await margins())){assert.ok(value>=11.5&&value<14,'fixed contour/bubble padding before scaling')}
        const wheel=async(selector)=>{
          const data=await pet.webContents.executeJavaScript('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,n:window.wheels}})()');
          pet.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(data.x),y:Math.round(data.y),deltaY:100,deltaX:0});
          await wait(()=>pet.webContents.executeJavaScript('window.wheels>'+data.n));
        };
        await wheel('#fixture-model');
        await wait(async()=>Math.abs((await bubbleMetrics()).model-beforeScale.model)>1);
        const afterScale=await bubbleMetrics();
        assert.equal(afterScale.width,beforeScale.width);assert.equal(afterScale.font,beforeScale.font);
        await wait(async()=>Object.values(await margins()).every(value=>value>=11.5&&value<14));
        const expectedScale=await pet.webContents.executeJavaScript('window.lastWheelDelta<0?1.1:0.9');
        assert.equal(JSON.parse(readFileSync(join(app.getPath('userData'),'pet-settings.json'),'utf8')).scale,expectedScale);
        await wheel('.dsh-avatar-bubble-text');
        assert.equal((await bubbleMetrics()).model,afterScale.model,'bubble wheel keeps scrolling instead of scaling the character');
        gui.emit('system-context-menu',{preventDefault(){}});assert.ok(resetSize);resetSize.click();
        await wait(async()=>Math.abs((await bubbleMetrics()).model-beforeScale.model)<1);
        await wait(async()=>Object.values(await margins()).every(value=>value>=11.5&&value<14));
        pet.setPosition(pet.getBounds().x,area.y);
        assert.ok(await pet.webContents.executeJavaScript('(()=>{const top=document.querySelector(".dsh-avatar-bubble").getBoundingClientRect().top;return top>=11.5&&top<14})()'),'fixed bubble padding at native work-area top');
        const bubble=await pet.webContents.executeJavaScript('window.fixture.bubble()');
        const security=await pet.webContents.executeJavaScript('(async()=>({node:typeof require,host:typeof window.dshDesktop,clipboard:(await navigator.permissions.query({name:"clipboard-write"})).state}))()');
        await pet.webContents.executeJavaScript('window.fixture.click()');
        await wait(()=>gui.isVisible()&&gui.isFocused());
        assert.equal(await gui.webContents.executeJavaScript('document.querySelector("[data-composer-input]").textContent'),'retained draft');
        pet.hide();
        try { await wait(()=>pet.webContents.executeJavaScript('window.controls.some(c=>c.type==="visibility"&&!c.visible)')) }
        catch(error){console.log('Hidden-pet diagnostics',JSON.stringify({visible:pet.isVisible(),errors,page:await pet.webContents.executeJavaScript('({controls:window.controls,hidden:document.hidden,state:window.dshCompanionPet.getState()})')}));throw error}
        gui.hide();complete(3,'must not reappear');
        assert.equal(pet.isVisible(),false);
        gui.emit('system-context-menu',{preventDefault(){}});
        assert.ok(petToggle);petToggle.click();assert.equal(pet.isDestroyed(),true);
        await wait(()=>gui.webContents.executeJavaScript('document.documentElement.dataset.companionAvatarHost==="web"'));
        assert.equal(ipcMain.listenerCount('companion:pet-intent'),0);
        assert.equal(toasts,0);assert.equal(unread,2);
        assert.deepEqual(preloadErrors,[]);assert.deepEqual(errors,[]);
        writeFileSync(${JSON.stringify(result)},JSON.stringify({bubble,security,preloadErrors,errors}));
      } finally {if(!gui.isDestroyed())gui.destroy();await closed;app.quit()}
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
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Electron pet check timed out: ${diagnostics}`)) }, 30_000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      code === 0 && signal === null ? resolve() : reject(new Error(`Electron exit ${code}, signal ${signal}: ${diagnostics}`))
    })
  })
  const data = JSON.parse(await readFile(result, 'utf8'))
  assert.equal(data.security.node, 'undefined')
  assert.equal(data.security.host, 'undefined')
  assert.equal(data.security.clipboard, 'denied')
  assert.equal(data.bubble.sessionId, 'other')
  assert.equal(data.bubble.durationMs, 12000)
  console.log('PASS: Electron contour-cropped window, fixed 12px visible-union padding before/after native wheel scaling and at the screen top, stable bubble font/width, scrolling, saved scale/reset, shared session, GUI display reset, early host marker, notification routing, click restoration, hidden pause, permissions and cleanup. Fixture check; OS transparent-pixel input and real Live2D remain separate qualifications.')
} finally {
  if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve))
    child.kill()
    await closed
  }
  await new Promise(resolve => server.close(resolve))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
