import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ChromiumTestSession} from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-following-collections-')),profile=join(temporary,'profile'),shots='/tmp/xivary-following-collections-screenshots';await mkdir(shots,{recursive:true});
let chrome=new ChromiumTestSession(profile),id,page;
const url=()=>`chrome-extension://${id}/src/authors/authors.html`;
const rpc=code=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const r=new RepositoryClient();return ${code};})()`;
const evaluate=code=>chrome.evaluate(page.sessionId,code);
async function ready(){try{await chrome.until(page.sessionId,"!!document.querySelector('#count')?.textContent&&document.querySelector('#filter')?.disabled===false");}catch(error){console.log(await evaluate("location.href+'\\n'+document.body.innerText"));throw error;}}
const selection=()=>evaluate("document.querySelector('.collection-link[aria-current]').dataset.collectionId");
const order=()=>evaluate("[...document.querySelectorAll('.collection-link')].map(n=>n.dataset.collectionId)");
const state="chrome.storage.local.get('arxivResearchLibrary').then(v=>v.arxivResearchLibrary)";
async function open(address=url()) {
 page=await chrome.page();await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.selections=[];new MutationObserver(()=>{if(location.pathname.endsWith('/authors/authors.html')){const n=document.querySelector('.collection-link[aria-current]');if(n)selections.push(n.dataset.collectionId)}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current']})`},page.sessionId);
 await chrome.send('Page.navigate',{url:address},page.sessionId);await ready();
 await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:950,deviceScaleFactor:1,mobile:false},page.sessionId);await evaluate('document.fonts.ready');
}
async function first(id){assert.equal(await selection(),id);assert.equal(await evaluate(`selections.every(value=>value===${JSON.stringify(id)})`),true,'no initial All Following flash');}
async function select(id){await chrome.click(page.sessionId,`.collection-link[data-collection-id="${id}"]`);await chrome.until(page.sessionId,rpc(`(await r.getAuthorLibrary()).selectedCollectionId===${JSON.stringify(id)}`));assert.equal(await selection(),id);}
async function key(key){for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key,code:key},page.sessionId);}
async function shot(name){const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(shots,name),Buffer.from(data,'base64'));}
const handle=id=>`#collection-list [data-reorder-handle="${id}"]`;
async function drag(id,y,{cancel=false,valid=true}={}) {
 const selector=handle(id);await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
 const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p},page.sessionId);
 await chrome.until(page.sessionId,`document.elementFromPoint(${p.x},${p.y})?.closest('.reorder-handle')===document.querySelector(${JSON.stringify(selector)})`);
 await chrome.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1},page.sessionId);
 for(let i=1;i<=3;i++)await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y+(y-p.y)*i/3,button:'left',buttons:1},page.sessionId);
 assert.equal(await evaluate("!!document.querySelector('.drop-before,.drop-after')"),valid);
 if(cancel)await key('Escape');await chrome.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y,button:'left',buttons:0,clickCount:1},page.sessionId);await ready();
}
async function quietPointer(){assert.equal(await evaluate("!document.querySelector('.reorder-handle:focus,.reorder-handle:focus-visible,.reorder-dragging,.drop-before,.drop-after')"),true);assert.equal(await evaluate("document.querySelector('#status').textContent"),'');}
async function moved(id,index){await chrome.until(page.sessionId,`document.querySelectorAll('.collection-link')[${index}].dataset.collectionId===${JSON.stringify(id)}&&!document.querySelector('#filter').disabled`);}
const top=()=>evaluate("document.querySelector('[data-reorder-id]').getBoundingClientRect().top+1"),bottom=()=>evaluate("document.querySelector('#collection-list').getBoundingClientRect().bottom-2");
async function geometry(id){return evaluate(`(()=>{const row=document.querySelector('.collection-link[data-collection-id="${id}"]').closest('.collection-row'),rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,top:r.top}};return {row:rect(row),grip:rect(row.querySelector('.reorder-handle')),name:rect(row.querySelector('.collection-label')),count:rect(row.querySelector('.collection-count')),menu:rect(row.querySelector('.collection-more')),opacity:getComputedStyle(row.querySelector('.reorder-handle')).opacity}})()`);}
function aligned(g){assert.ok(g.row.left<=g.grip.left&&g.grip.right<=g.name.left);assert.ok(g.name.right<=g.count.left&&g.count.right+4<=g.menu.left&&g.menu.right<=g.row.right);}
try {
 id=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;await open();console.log((await chrome.send('Browser.getVersion')).product);
 const seed=await evaluate(rpc(`(async()=>{const a=await r.createAuthorCollection('Following',{displayName:'Alex Kim',alias:'Advisor'}),b=await r.createAuthorCollection('A very long collection name with geometry, representations and Unicode — 猫',{displayName:'Renée Smith',alias:'Collaborator'}),c=await r.createAuthorCollection('Empty');await r.addAuthorToCollection({displayName:'Alex Kim'},b.id);const library=await r.createPaperCollection('Library choice');await r.setLibrarySelection(library.id);await r.setOrganizeFollowedAuthorsIntoCollections(true);const {emptyQueue,mergeQueue}=await import('../feed/queue.js');await r.putFollowingFeedCache(mergeQueue(emptyQueue(),[],await r.listFollowing(),[],{now:Date.now()}).queue);return {a:a.id,b:b.id,c:c.id,library:library.id};})()`));
 await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');await select(seed.b);
 const owned=await evaluate(state),authors=await evaluate("[...document.querySelectorAll('.author-row')].map(n=>n.dataset.authorId)");
 assert.equal(await evaluate("!document.querySelector('.collection-item:first-child .reorder-handle')&&!document.querySelector('#show-create .reorder-handle')&&document.querySelectorAll('#collection-list .reorder-handle').length===3"),true);
 await evaluate("document.querySelector('#filter').focus()");await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1200,y:20},page.sessionId);const cold=await geometry(seed.b);aligned(cold);assert.equal(cold.opacity,'0');
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:cold.name.left+5,y:cold.name.top+5},page.sessionId);const hover=await geometry(seed.b);aligned(hover);assert.equal(hover.opacity,'1');for(const key of ['row','grip','name','count','menu'])assert.deepEqual(hover[key],cold[key]);await shot('following-hover.png');
 // Repeated native upward and downward moves preserve selection and author order.
 for(let i=0;i<3;i++){
  await drag(seed.c,await top());await moved(seed.c,1);await quietPointer();await drag(seed.c,await bottom());await moved(seed.c,3);await quietPointer();
  assert.equal(await selection(),seed.b);assert.deepEqual(await evaluate("[...document.querySelectorAll('.author-row')].map(n=>n.dataset.authorId)"),authors);
 }
 assert.equal(await evaluate("getComputedStyle(document.querySelector('#reorder-status')).width==='1px'&&document.querySelector('#reorder-status').textContent.includes('position 3')"),true);
 await evaluate(`document.querySelector(${JSON.stringify(handle(seed.c))}).focus()`);await key('Home');await moved(seed.c,1);
 assert.equal(await evaluate("document.activeElement.classList.contains('reorder-handle')&&document.activeElement.matches(':focus-visible')"),true);
 await key('End');await moved(seed.c,3);await key('ArrowUp');await moved(seed.c,2);await key('ArrowDown');await moved(seed.c,3);
 const stable=await order();await drag(seed.c,await top(),{cancel:true});await quietPointer();assert.deepEqual(await order(),stable);
 const fixed=await evaluate("document.querySelector('.collection-item').getBoundingClientRect().top+8");await drag(seed.c,fixed,{valid:false});await quietPointer();assert.deepEqual(await order(),stable);
 const newY=await evaluate("document.querySelector('#show-create').getBoundingClientRect().top+8");await drag(seed.c,newY,{valid:false});await quietPointer();assert.deepEqual(await order(),stable);
 await chrome.click(page.sessionId,`.collection-link[data-collection-id="${seed.a}"] + .collection-more`);assert.equal(await selection(),seed.b);assert.deepEqual(await evaluate("[...document.querySelectorAll('.collection-menu [data-action]')].map(n=>n.dataset.action)"),['rename','delete']);await key('Escape');
 const after=await evaluate(state);assert.deepEqual(after,owned,'completed round-trip moves leave all owner data unchanged');
 for(const [selector,path]of [['.app-nav a[href*="library/"]','/library/library.html'],['.settings-link','/settings/settings.html'],['.app-nav a[href*="offline/"]','/offline/offline.html'],['.app-nav a[href*="feed/"]','/feed/feed.html']]){
  await chrome.click(page.sessionId,selector);await chrome.until(page.sessionId,`location.pathname.endsWith(${JSON.stringify(path)})&&!!document.querySelector('.app-nav')`);
  await chrome.until(page.sessionId,"document.readyState==='complete'");
  await evaluate("document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
  if(path.includes('settings'))await chrome.until(page.sessionId,"document.querySelector('#organize-author-collections')?.disabled===false");
  if(path.includes('library')){await ready();assert.equal(await selection(),seed.library);}
  await chrome.click(page.sessionId,'.app-nav a[href*="authors/"]');await ready();await first(seed.b);
 }
 await chrome.send('Target.closeTarget',{targetId:page.targetId});await open();await first(seed.b);
 await chrome.send('ServiceWorker.enable',{},page.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},page.sessionId);await chrome.send('Page.reload',{},page.sessionId);await ready();await first(seed.b);
 await evaluate(rpc('r.setOrganizeFollowedAuthorsIntoCollections(false)'));await chrome.send('Page.reload',{},page.sessionId);await ready();assert.equal(await evaluate("document.querySelector('#collection-sidebar').hidden"),true);assert.equal(await evaluate(rpc('(await r.getAuthorLibrary()).selectedCollectionId')),seed.b);
 await evaluate(rpc('r.setOrganizeFollowedAuthorsIntoCollections(true)'));await chrome.send('Page.reload',{},page.sessionId);await ready();await first(seed.b);
 await open(url()+`?collectionId=${encodeURIComponent(seed.a)}`);await first(seed.a);await chrome.until(page.sessionId,rpc(`(await r.getAuthorLibrary()).selectedCollectionId===${JSON.stringify(seed.a)}`));
 await open(url()+'?collectionId=');await first('');await select(seed.b);await open();await first(seed.b);
 // Stress the reserved count/menu tracks with the original long name at both widths.
 for(const width of [360,1280]) {
  await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false},page.sessionId);
  await evaluate(`document.querySelector('.collection-link[data-collection-id="${seed.b}"] .collection-count').textContent='123456'`);aligned(await geometry(seed.b));
  assert.equal(await evaluate(`(()=>{const n=document.querySelector('.collection-link[data-collection-id="${seed.b}"] .collection-label');return n.scrollWidth>n.clientWidth&&document.documentElement.scrollWidth<=innerWidth})()`),true);
  await shot(`long-name-${width}.png`);await evaluate(`document.querySelector('.collection-link[data-collection-id="${seed.b}"] .collection-count').textContent='2'`);
 }
 // Rename uses the existing menu and keeps the stored stable ID.
 await chrome.click(page.sessionId,`.collection-link[data-collection-id="${seed.b}"] + .collection-more`);await chrome.click(page.sessionId,'.collection-menu [data-action=rename]');await evaluate("document.querySelector('[data-rename-id]').value='Renamed — 先生'");await key('Enter');await chrome.until(page.sessionId,"!document.querySelector('[data-rename-id]')&&!document.querySelector('#filter').disabled");assert.equal(await selection(),seed.b);
 await drag(seed.c,await top());await moved(seed.c,1);await quietPointer();const persisted=await evaluate(rpc('r.getAuthorLibrary()')),backup=await evaluate(rpc("r.exportBackup('all')"));
 for(const width of [1280,360]){await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false},page.sessionId);aligned(await geometry(seed.b));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await shot(`following-${width}.png`);}
 const ax=await chrome.send('Accessibility.getFullAXTree',{},page.sessionId);assert.ok(ax.nodes.some(n=>n.role?.value==='button'&&n.name?.value==='Move Renamed — 先生'));assert.ok(ax.nodes.some(n=>n.role?.value==='StaticText'&&n.name?.value==='Moved Empty to position 1 of 3.'));
 await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id,id);await open();await first(seed.b);assert.deepEqual(await order(),['',...persisted.collections.map(c=>c.id)]);assert.deepEqual((await evaluate(rpc('r.getAuthorLibrary()'))).authors,persisted.authors);assert.equal((await evaluate(rpc('r.getPaperLibrary()'))).selectedCollectionId,seed.library);
 await select('');await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');await select(seed.c);
 await chrome.click(page.sessionId,`.collection-link[data-collection-id="${seed.c}"] + .collection-more`);await chrome.click(page.sessionId,'.collection-menu [data-action=delete]');await chrome.click(page.sessionId,'.collection-delete-dialog .button-danger');await chrome.until(page.sessionId,"!document.querySelector('.collection-delete-dialog')&&document.querySelector('.collection-link[aria-current]').dataset.collectionId===''");
 for(const value of [{version:1,collectionId:'collection:missing'},null,{version:1,collectionId:123}]){await evaluate(`chrome.storage.local.set({'xivary:following-selection':${JSON.stringify(value)}})`);await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');}
 // Clean-profile import restores organization/order, excluding both UI selections.
 await chrome.close();chrome=new ChromiumTestSession(join(temporary,'restore'));id=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;await open();await evaluate(rpc('r.setOrganizeFollowedAuthorsIntoCollections(true)'));await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');assert.equal(await evaluate("document.querySelectorAll('#collection-list .reorder-handle').length"),0);
 const one=await evaluate(rpc("r.createAuthorCollection('Only')"));await chrome.send('Page.reload',{},page.sessionId);await ready();await select(one.id);await evaluate(`document.querySelector(${JSON.stringify(handle(one.id))}).focus()`);await key('End');assert.deepEqual(await order(),['',one.id]);await evaluate(rpc(`r.deleteAuthorCollection(${JSON.stringify(one.id)})`));
 await evaluate(rpc(`r.importBackup([{kind:'zip',data:${JSON.stringify(backup.base64)}}])`));await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');const restored=await evaluate(rpc('r.getAuthorLibrary()'));assert.deepEqual(restored.collections,persisted.collections);assert.deepEqual(restored.authors,persisted.authors);assert.deepEqual(restored.memberships,persisted.memberships);assert.equal((await evaluate(rpc('r.getPaperLibrary()'))).selectedCollectionId,'');
 console.log(`FOLLOWING COLLECTIONS PASS: repeated native upward/downward handle drag and cancellation, keyboard focus and silent live announcements, fixed aggregate/New, count/menu/long-name geometry, independent Library selection and author order, all top-level navigation/Settings, close/reopen/worker/browser restart, hidden organization, explicit routes, rename/delete/stale fallback, empty/single collections and clean-profile full ZIP restoration; screenshots ${shots}`);
}finally{await chrome.close();await rm(temporary,{recursive:true,force:true});}
