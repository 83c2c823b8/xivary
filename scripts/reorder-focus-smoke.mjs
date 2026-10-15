import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession } from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-reorder-focus-'));
const chrome=new ChromiumTestSession(join(temporary,'profile')),shots='/tmp/xivary-reorder-focus-screenshots';await mkdir(shots,{recursive:true});
const probe=process.env.XIVARY_FOCUS_PROBE==='1';
const client=code=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const r=new RepositoryClient();return ${code};})()`;
const key=async(p,key)=>{for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key,code:key},p.sessionId);};
const focusState=p=>chrome.evaluate(p.sessionId,"({active:document.activeElement.outerHTML.slice(0,200),handles:[...document.querySelectorAll('.reorder-handle')].filter(n=>n===document.activeElement||n.matches(':focus-visible')).map(n=>({id:n.dataset.reorderHandle,visible:n.matches(':focus-visible'),outline:getComputedStyle(n).outlineStyle})),stale:!!document.querySelector('.drop-before,.drop-after,.reorder-dragging')})");
async function ready(p){await chrome.until(p.sessionId,"!!document.querySelector('#count')?.textContent&&document.querySelector('#filter')?.disabled===false");}
async function drag(p,selector,y,{cancel,priorKeyboard=false}={}){
 await chrome.evaluate(p.sessionId,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
 if(priorKeyboard){await chrome.evaluate(p.sessionId,"document.querySelector('#filter').focus()");await key(p,'Tab');}
 const point=await chrome.evaluate(p.sessionId,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point},p.sessionId);
 // A real user starts from a revealed handle; wait for Chrome's hover hit test.
 await chrome.until(p.sessionId,`document.elementFromPoint(${point.x},${point.y})?.closest('.reorder-handle')===document.querySelector(${JSON.stringify(selector)})`);
 await chrome.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1},p.sessionId);
 // Keep CDP's compositor button state consistent throughout the pressed gesture.
 const x=cancel==='outside'?1100:point.x;
 for(let i=1;i<=3;i++)await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+(x-point.x)*i/3,y:point.y+(y-point.y)*i/3,button:'left',buttons:1},p.sessionId);
 if(cancel!=='click')await chrome.until(p.sessionId,"!!document.querySelector('.reorder-dragging')");
 if(cancel==='escape')await key(p,'Escape');
 else if(cancel==='capture')await chrome.evaluate(p.sessionId,"(()=>{for(const n of document.querySelectorAll('.reorder-handle'))if(n.hasPointerCapture(1))n.releasePointerCapture(1)})()");
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1},p.sessionId);
 await chrome.until(p.sessionId,"!document.querySelector('#filter').disabled");
}
async function touchDrag(p,selector,y,{cancel=false}={}) {
 await chrome.evaluate(p.sessionId,`document.querySelector(${JSON.stringify(selector)}).focus()`);
 const point=await chrome.evaluate(p.sessionId,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await chrome.send('Emulation.setTouchEmulationEnabled',{enabled:true},p.sessionId);
 await chrome.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]},p.sessionId);
 await chrome.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y}]},p.sessionId);
 await chrome.until(p.sessionId,"!!document.querySelector('.reorder-dragging')");
 await chrome.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]},p.sessionId);
 await chrome.send('Emulation.setTouchEmulationEnabled',{enabled:false},p.sessionId);await ready(p);
}
try {
 const id=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;
 const library=await chrome.page(`chrome-extension://${id}/src/library/library.html`);await ready(library);
 const collection=await chrome.evaluate(library.sessionId,client(`(async()=>{const c=await r.createPaperCollection('Focus fixture');for(let i=1;i<=3;i++){await r.addPaperToCollection({arxivId:'2610.0000'+i,title:'Focus paper '+i,authors:['Alex Kim']},c.id);await r.followAuthor({displayName:'Focus Author '+i});}return c.id;})()`));
 await chrome.send('Page.reload',{},library.sessionId);await ready(library);await chrome.click(library.sessionId,`.collection-link[data-collection-id="${collection}"]`);
 const authors=await chrome.page(`chrome-extension://${id}/src/authors/authors.html`);await ready(authors);
 for(const [kind,p,list] of [['collections',library,'#collection-list'],['papers',library,'#papers'],['authors',authors,'#authors']]) {
  await chrome.send('Page.bringToFront',{},p.sessionId);
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false},p.sessionId);
  for(let i=0;i<6;i++){
   // Collection rows wrap their handles one level deeper.
   const last=await chrome.evaluate(p.sessionId,`(()=>{const n=[...document.querySelectorAll('${list} [data-reorder-handle]')].at(-1);return n.dataset.reorderHandle})()`);
   const target=`${list} [data-reorder-handle="${last}"]`;
   const y=await chrome.evaluate(p.sessionId,`document.querySelector('${list} [data-reorder-id]').getBoundingClientRect().top+1`);
   await drag(p,target,y,{priorKeyboard:i%2===0});
   await chrome.until(p.sessionId,`document.querySelector('${list} [data-reorder-handle]').dataset.reorderHandle===${JSON.stringify(last)}&&!document.querySelector('#filter').disabled`);
   const state=await focusState(p);console.log(JSON.stringify({kind,iteration:i,...state}));
   if(!probe){assert.deepEqual(state.handles,[],'pointer drop leaves no focused handle');assert.equal(state.stale,false);}
  }
  const {data:pointerShot}=await chrome.send('Page.captureScreenshot',{},p.sessionId);await writeFile(join(shots,kind+'-pointer.png'),Buffer.from(pointerShot,'base64'));
  await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1200,y:20},p.sessionId);
  if(!probe)assert.equal(await chrome.evaluate(p.sessionId,`[...document.querySelectorAll('${list} .reorder-handle')].every(n=>getComputedStyle(n).opacity==='0')`),true,'hover ends normally after pointer completion');
  for(const cancel of ['escape','capture','outside','click']){
   const handle=await chrome.evaluate(p.sessionId,`document.querySelector('${list} .reorder-handle').dataset.reorderHandle`);
   const selector=`${list} [data-reorder-handle="${handle}"]`;
   const before=await chrome.evaluate(p.sessionId,`[...document.querySelectorAll('${list} [data-reorder-handle]')].map(n=>n.dataset.reorderHandle)`);
   const y=await chrome.evaluate(p.sessionId,`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top+${cancel==='click'?16:180}`);
   await drag(p,selector,y,{cancel,priorKeyboard:true});
   const state=await focusState(p);console.log(JSON.stringify({kind,cancel,...state}));
   if(!probe){assert.equal(state.stale,false);if(cancel!=='click')assert.deepEqual(state.handles,[]);assert.deepEqual(await chrome.evaluate(p.sessionId,`[...document.querySelectorAll('${list} [data-reorder-handle]')].map(n=>n.dataset.reorderHandle)`),before);}
  }
  for(const cancel of [false,true]) {
   const last=await chrome.evaluate(p.sessionId,`[...document.querySelectorAll('${list} .reorder-handle')].at(-1).dataset.reorderHandle`);
   const y=await chrome.evaluate(p.sessionId,`document.querySelector('${list} [data-reorder-id]').getBoundingClientRect().top+1`);
   const before=await chrome.evaluate(p.sessionId,`[...document.querySelectorAll('${list} .reorder-handle')].map(n=>n.dataset.reorderHandle)`);
   await touchDrag(p,`${list} [data-reorder-handle="${last}"]`,y,{cancel});
   if(!cancel)await chrome.until(p.sessionId,`document.querySelector('${list} .reorder-handle').dataset.reorderHandle===${JSON.stringify(last)}&&!document.querySelector('#filter').disabled`);
   const state=await focusState(p);if(!probe){assert.deepEqual(state.handles,[]);assert.equal(state.stale,false);if(cancel)assert.deepEqual(await chrome.evaluate(p.sessionId,`[...document.querySelectorAll('${list} .reorder-handle')].map(n=>n.dataset.reorderHandle)`),before);}
  }
  await chrome.evaluate(p.sessionId,`document.querySelector('${list} .reorder-handle').focus()`);await key(p,'End');await ready(p);
  const keyboard=await focusState(p);console.log(JSON.stringify({kind,keyboard:true,...keyboard}));
  if(!probe){assert.equal(keyboard.handles.length,1);assert.equal(keyboard.handles[0].visible,true);assert.equal(keyboard.handles[0].outline,'solid');}
  const {data}=await chrome.send('Page.captureScreenshot',{},p.sessionId);await writeFile(join(shots,kind+'-keyboard.png'),Buffer.from(data,'base64'));
 }
 console.log(`REORDER FOCUS ${probe?'PROBE':'PASS'}: repeated mouse and emulated-touch drags, mixed keyboard/pointer input, cancellation/capture loss/outside/click, keyboard focus across all three row types; ${shots}`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}
