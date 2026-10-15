import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ChromiumTestSession,waitFor} from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-following-reorder-'));
const extension=join(temporary,'extension'),profile=join(temporary,'profile'),shots='/tmp/xivary-following-reorder-screenshots';await mkdir(shots,{recursive:true});
execFileSync('tar',['-x','-C',temporary],{input:execFileSync('git',['archive','fed11ad','extension'],{cwd:root,maxBuffer:30*1024*1024})});
let chrome=new ChromiumTestSession(profile),id,page;
const client=code=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${code};})()`;
const raw="chrome.storage.local.get('arxivResearchLibrary').then(v=>v.arxivResearchLibrary)";
const names=['Alex Kim','Renée Smith','Beta Scholar','A Very Long Followed Author Name with Mathematics and Representation Theory — 猫'];
async function open(){page=await chrome.page(`chrome-extension://${id}/src/authors/authors.html`);await chrome.until(page.sessionId,"document.querySelector('#count')?.textContent.includes('author')");}
const ids=()=>chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.author-row')].map(n=>n.dataset.authorId)");
async function key(key){for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key,code:key},page.sessionId);}
async function shot(name){await chrome.evaluate(page.sessionId,'document.fonts.ready');const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(shots,name),Buffer.from(data,'base64'));}
async function drag(authorId,y,{cancel=false}={}){
 const selector=`[data-reorder-handle="${authorId}"]`;
 await chrome.evaluate(page.sessionId,`document.querySelector(${JSON.stringify(selector)}).focus()`);
 const point=await chrome.evaluate(page.sessionId,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point},page.sessionId);
 await chrome.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1},page.sessionId);
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y,button:'left',buttons:1},page.sessionId);
 assert.equal(await chrome.evaluate(page.sessionId,"!!document.querySelector('.drop-before,.drop-after')"),true);
 await shot('drag-insertion.png');if(cancel)await key('Escape');
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y,button:'left',buttons:0,clickCount:1},page.sessionId);
 await chrome.until(page.sessionId,"!document.querySelector('#filter').disabled");
}
async function enabled(){if((await chrome.send('Extensions.getExtensions')).extensions.find(e=>e.id===id)?.enabled)return;const manager=await chrome.page('chrome://extensions/');await chrome.until(manager.sessionId,'!!chrome.management');assert.equal(await chrome.evaluate(manager.sessionId,`new Promise(resolve=>chrome.management.setEnabled(${JSON.stringify(id)},true,()=>resolve(chrome.runtime.lastError?.message??'enabled')))`),'enabled');}
function records(list){return [...list].sort((a,b)=>a.id.localeCompare(b.id));}
try {
 id=(await chrome.send('Extensions.loadUnpacked',{path:extension})).id;await open();console.log((await chrome.send('Browser.getVersion')).product);
 await chrome.evaluate(page.sessionId,client(`(async()=>{for(const displayName of ${JSON.stringify(names)})await repository.followAuthor({displayName});await repository.savePaper({arxivId:'2610.00001',versionedId:'2610.00001v1',title:'My preserved bookmark',authors:['Alex Kim']});})()`));
 await chrome.evaluate(page.sessionId,`(async()=>{const {BrowserLocalStorage}=await import('../lib/storage.js');const disk=new BrowserLocalStorage(),s=await disk.read();for(let i=0;i<s.authors.length;i++){s.authors[i].followedAt=new Date(Date.UTC(2026,9,10+i)).toISOString();s.authors[i].alias='Custom alias '+i;s.authors[i].searchIdentifiers={query:s.authors[i].displayName};}await disk.write(s);})()`);
 const old=await chrome.evaluate(page.sessionId,raw);assert.equal(old.schemaVersion,6);
 await chrome.send('Page.reload',{},page.sessionId);await chrome.until(page.sessionId,"document.querySelectorAll('.author-row').length===4");const priorVisible=await ids();
 const target=await waitFor(async()=> (await chrome.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.includes(id)),'worker');
 const worker=(await chrome.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await chrome.send('Fetch.enable',{patterns:[{urlPattern:'https://arxiv.org/*'}]},worker);const pdf='%PDF-1.4\nFollowing migration byte retention fixture\n%%EOF\n';
 chrome.listeners.push(m=>{if(m.method==='Fetch.requestPaused'&&m.sessionId===worker)void chrome.send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/pdf'}],body:Buffer.from(pdf).toString('base64')},worker);});
 await chrome.evaluate(page.sessionId,client("repository.saveOfflinePaper({arxivId:'2610.00001',versionedId:'2610.00001v1',title:'Preserved offline copy',authors:['Alex Kim']})"));
 await rm(extension,{recursive:true});await cp(join(root,'dist/chromium'),extension,{recursive:true});
 await chrome.send('Runtime.evaluate',{expression:'setTimeout(()=>chrome.runtime.reload(),50)'},page.sessionId);
 await waitFor(async()=> (await chrome.send('Extensions.getExtensions')).extensions.some(e=>e.id===id&&!e.enabled),'reload');
 assert.equal((await chrome.send('Extensions.loadUnpacked',{path:extension})).id,id);await enabled();await open();
 await chrome.until(page.sessionId,"document.querySelectorAll('.author-row').length===4");assert.deepEqual(await ids(),priorVisible);
 const upgraded=await chrome.evaluate(page.sessionId,raw);assert.equal(upgraded.schemaVersion,8);assert.deepEqual(records(upgraded.authors),records(old.authors));
 for(const field of ['favorites','paperCollections','paperMemberships','paperOrdering','memberships','collections','settings'])assert.deepEqual(upgraded[field],old[field]);
 assert.equal(await chrome.evaluate(page.sessionId,client("(await repository.readOfflinePdf('2610.00001')).blob.text()")),pdf);
 assert.deepEqual(await chrome.evaluate(page.sessionId,"chrome.storage.local.get('xivary:local-migration:6:8').then(v=>v['xivary:local-migration:6:8'].source.authors)"),old.authors);
 await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:950,deviceScaleFactor:1,mobile:false},page.sessionId);
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1200,y:20},page.sessionId);
 assert.equal(await chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.reorder-handle')].every(n=>getComputedStyle(n).opacity==='0')"),true);
 const geometry=()=>chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.author-row')].map(row=>{const r=row.querySelector('h2').getBoundingClientRect(),g=row.querySelector('.reorder-handle').getBoundingClientRect();return {x:r.x,width:r.width,gLeft:g.left,gRight:g.right}})");
 const before=await geometry();await chrome.evaluate(page.sessionId,"document.querySelector('.reorder-handle').focus()");assert.deepEqual(await geometry(),before);
 assert.equal(await chrome.evaluate(page.sessionId,"getComputedStyle(document.querySelector('.reorder-handle')).opacity"),'1');
 assert.equal(await chrome.evaluate(page.sessionId,"[...document.querySelectorAll('.author-row')].every(n=>n.querySelector('.reorder-handle').getBoundingClientRect().right<=n.querySelector('h2').getBoundingClientRect().left)"),true);
 const getTop=()=>chrome.evaluate(page.sessionId,"document.querySelector('#authors').getBoundingClientRect().top+1"),getBottom=()=>chrome.evaluate(page.sessionId,"document.querySelector('#authors').getBoundingClientRect().bottom-2");
 const targets=(await chrome.send('Target.getTargets')).targetInfos.length;
 await drag(priorVisible[3],await getTop());await chrome.until(page.sessionId,"document.querySelector('#reorder-status').textContent.includes('position 1')");
 let order=[priorVisible[3],...priorVisible.slice(0,3)];assert.deepEqual(await ids(),order);
 await drag(order[0],await getBottom());await chrome.until(page.sessionId,"document.querySelector('#reorder-status').textContent.includes('position 4')");order=[...order.slice(1),order[0]];assert.deepEqual(await ids(),order);
 await chrome.evaluate(page.sessionId,`document.querySelector('[data-reorder-handle="${order[3]}"]').focus()`);
 await key('Home');await chrome.until(page.sessionId,"document.querySelector('#reorder-status').textContent.includes('position 1')");order=[order[3],...order.slice(0,3)];assert.deepEqual(await ids(),order);
 await drag(order[3],await getTop(),{cancel:true});assert.deepEqual(await ids(),order);assert.equal((await chrome.send('Target.getTargets')).targetInfos.length,targets);
 await shot('following-desktop.png');
 const one=(await chrome.evaluate(page.sessionId,client('repository.listFollowing()')))[0];
 await chrome.evaluate(page.sessionId,`document.querySelector('#filter').value=${JSON.stringify(names[0])};document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))`);
 assert.equal((await ids()).length,1);assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('#authors .reorder-handle').disabled"),true);
 await chrome.evaluate(page.sessionId,"document.querySelector('#filter').value='no match';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");assert.equal((await ids()).length,0);
 await chrome.evaluate(page.sessionId,"document.querySelector('#filter').value='';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");assert.deepEqual(await ids(),order);
 const group=await chrome.evaluate(page.sessionId,client(`repository.createAuthorCollection('Subset',${JSON.stringify(one)})`));await chrome.evaluate(page.sessionId,client('repository.setOrganizeFollowedAuthorsIntoCollections(true)'));
 await chrome.send('Page.reload',{},page.sessionId);await chrome.until(page.sessionId,"document.querySelector('#collection-sidebar').hidden===false && document.querySelectorAll('.author-row').length===4");
 await chrome.click(page.sessionId,`.collection-link[data-collection-id="${group.id}"]`);assert.equal((await ids()).length,1);assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('#authors .reorder-handle').disabled"),false);
 await chrome.click(page.sessionId,'.collection-link[data-collection-id=""]');assert.deepEqual(await ids(),order);
 await chrome.send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:false},page.sessionId);assert.equal(await chrome.evaluate(page.sessionId,'document.documentElement.scrollWidth<=innerWidth'),true);await shot('following-360.png');
 const ax=await chrome.send('Accessibility.getFullAXTree',{},page.sessionId);assert.ok(ax.nodes.some(n=>n.role?.value==='button'&&n.name?.value===`Move ${one.displayName}`));
 const current=await chrome.evaluate(page.sessionId,raw);assert.deepEqual(records(current.authors),records(upgraded.authors));
 await chrome.send('ServiceWorker.enable',{},page.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},page.sessionId);assert.deepEqual((await chrome.evaluate(page.sessionId,client('repository.listFollowing()'))).map(a=>a.id),order);
 const backup=await chrome.evaluate(page.sessionId,client("repository.exportBackup('all')")),following=await chrome.evaluate(page.sessionId,client('repository.listFollowing()'));
 await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:extension})).id,id);await enabled();await open();assert.deepEqual(await ids(),order);
 assert.equal(await chrome.evaluate(page.sessionId,client("(await repository.readOfflinePdf('2610.00001')).blob.text()")),pdf);
 await chrome.close();chrome=new ChromiumTestSession(join(temporary,'restore'));id=(await chrome.send('Extensions.loadUnpacked',{path:extension})).id;await open();assert.equal((await ids()).length,0);
 await chrome.evaluate(page.sessionId,client(`repository.importBackup([{kind:'zip',data:${JSON.stringify(backup.base64)}}],'all')`));await chrome.send('Page.reload',{},page.sessionId);await chrome.until(page.sessionId,"document.querySelectorAll('.author-row').length===4");assert.deepEqual(await ids(),order);assert.deepEqual(await chrome.evaluate(page.sessionId,client('repository.listFollowing()')),following);
 console.log(`FOLLOWING REORDER PASS: real v0.5.0→current schema 6→8 upgrade, visible order/custom metadata/Library/PDF preservation, native upward/downward handle drag/Home/cancel, stable hover/focus/long-name/360px/AX, search guard/collection handles, worker/profile restart and full ZIP restore; screenshots ${shots}`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}
