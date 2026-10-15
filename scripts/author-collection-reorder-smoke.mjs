import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {ChromiumTestSession} from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),tmp=await mkdtemp(join(tmpdir(),'xivary-author-collections-')),extension=join(tmp,'extension'),profile=join(tmp,'profile'),shots='/tmp/xivary-author-collection-screenshots';
await cp(join(root,'dist/chromium'),extension,{recursive:true});await mkdir(shots,{recursive:true});
let chrome=new ChromiumTestSession(profile),id,page;
const raw="chrome.storage.local.get('arxivResearchLibrary').then(v=>v.arxivResearchLibrary)";
const rpc=code=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const r=new RepositoryClient();return ${code};})()`;
const evaluate=code=>chrome.evaluate(page.sessionId,code);
const ids=()=>evaluate("[...document.querySelectorAll('#authors .author-row')].map(n=>n.dataset.authorId)");
async function ready(){await chrome.until(page.sessionId,"document.querySelector('#count')?.textContent.includes('author')&&document.querySelector('#filter')?.disabled===false");}
async function enabled(){if((await chrome.send('Extensions.getExtensions')).extensions.find(e=>e.id===id)?.enabled)return;const m=await chrome.page('chrome://extensions/');await chrome.until(m.sessionId,'!!chrome.management');assert.equal(await chrome.evaluate(m.sessionId,`new Promise(resolve=>chrome.management.setEnabled(${JSON.stringify(id)},true,()=>resolve(chrome.runtime.lastError?.message??'enabled')))`),'enabled');}
async function open(collectionId){page=await chrome.page(`chrome-extension://${id}/src/authors/authors.html${collectionId===undefined?'':`?collectionId=${encodeURIComponent(collectionId)}`}`);await ready();await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:950,deviceScaleFactor:1,mobile:false},page.sessionId);await evaluate('document.fonts.ready');}
async function select(collectionId){await chrome.click(page.sessionId,`[data-collection-id="${collectionId}"]`);await ready();await chrome.until(page.sessionId,rpc(`(await r.getAuthorLibrary()).selectedCollectionId===${JSON.stringify(collectionId)}`));}
async function key(key){for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key,code:key},page.sessionId);}
const handle=id=>`#authors [data-reorder-handle="${id}"]`;
async function point(selector){return evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);}
async function shot(name){const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(shots,name),Buffer.from(data,'base64'));}
async function quiet(){assert.equal(await evaluate("!!document.querySelector('#authors .reorder-handle:focus,#authors .reorder-handle:focus-visible,#authors .reorder-dragging,#authors .drop-before,#authors .drop-after')"),false);assert.equal(await evaluate("document.querySelector('#status').textContent"),'');}
async function drag(id,targetId,after,{cancel=false}={}){
 const selector=handle(id),p=await point(selector);
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p},page.sessionId);
 const diagnostic=await evaluate(`(()=>{const h=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(h);return {disabled:h.disabled,cursor:s.cursor,opacity:s.opacity,hit:document.elementFromPoint(${p.x},${p.y})?.closest('.reorder-handle')===h}})()`);
 assert.deepEqual(diagnostic,{disabled:false,cursor:'grab',opacity:'1',hit:true},'selected-collection author handle must be enabled, hittable and grab');
 const target=await evaluate(`(()=>{const r=document.querySelector('#authors [data-author-id="${targetId}"]').getBoundingClientRect();return {x:${p.x},y:${after?'r.bottom-2':'r.top+2'}}})()`);
 await chrome.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1},page.sessionId);
 for(let i=1;i<=3;i++)await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y+(target.y-p.y)*i/3,button:'left',buttons:1},page.sessionId);
 assert.equal(await evaluate("!!document.querySelector('#authors .drop-before,#authors .drop-after')"),true);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).cursor`),'grabbing');
 await shot('author-insertion.png');if(cancel)await key('Escape');
 await chrome.send('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',buttons:0,clickCount:1},page.sessionId);await ready();await quiet();
}
async function reordered(expected){await chrome.until(page.sessionId,`JSON.stringify([...document.querySelectorAll('#authors .author-row')].map(n=>n.dataset.authorId))===${JSON.stringify(JSON.stringify(expected))}&&document.querySelector('#filter').disabled===false`);}
try {
 id=(await chrome.send('Extensions.loadUnpacked',{path:extension})).id;await open();console.log((await chrome.send('Browser.getVersion')).product);
 const seed=await evaluate(rpc(`(async()=>{const a=await r.createAuthorCollection('Geometry'),b=await r.createAuthorCollection('Other research'),empty=await r.createAuthorCollection('Empty'),single=await r.createAuthorCollection('Single');const authors=[];for(const displayName of ['George Dimitrov','Tom Bridgeland','Hiroshige Kajiura'])authors.push(await r.addAuthorToCollection({displayName},a.id));await r.addAuthorToCollection(authors[0],b.id);await r.addAuthorToCollection(authors[1],b.id);await r.addAuthorToCollection({displayName:'Another Researcher'},b.id);await r.addAuthorToCollection(authors[0],single.id);await r.setOrganizeFollowedAuthorsIntoCollections(true);await r.setFollowingSelection(a.id);return {a:a.id,b:b.id,empty:empty.id,single:single.id,authors:authors.map(a=>a.id)};})()`));
 // Representative installed v0.5.0 schema-7 data, including existing custom fields.
 const original=await evaluate(`(async()=>{const s=await ${raw};s.schemaVersion=7;delete s.authorOrdering;for(const a of s.authors){a.alias='My '+a.displayName;a.customName='先生 '+a.displayName;}await chrome.storage.local.set({arxivResearchLibrary:s});return s;})()`);
 await evaluate('setTimeout(()=>chrome.runtime.reload(),50)');await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal((await chrome.send('Extensions.loadUnpacked',{path:extension})).id,id);await enabled();await open();
 const source=await evaluate(raw);assert.equal(source.schemaVersion,8);const {schemaVersion,authorOrdering,...rest}=source,{schemaVersion:old,...before}=original;assert.deepEqual(rest,before);assert.deepEqual(authorOrdering,{version:1,collectionOrders:[]});
 assert.deepEqual(await evaluate("chrome.storage.local.get('xivary:local-migration:7:8').then(v=>v['xivary:local-migration:7:8'].source)"),original);
 assert.equal(await evaluate("fetch('./authors.js').then(r=>r.text())"),await readFile(join(root,'extension/src/authors/authors.js'),'utf8'),'loaded build matches current source');
 assert.equal(await evaluate("document.querySelector('.collection-link[aria-current]').dataset.collectionId"),seed.a);
 const [a,b,c]=seed.authors,sidebar=source.collections,global=source.authors.map(a=>a.id);
 assert.deepEqual(await ids(),[a,b,c]);
 const targetCount=(await chrome.send('Target.getTargets')).targetInfos.length;
 await drag(a,b,true);await reordered([b,a,c]);await shot('selected-authors-hover.png');
 await chrome.send('Page.reload',{},page.sessionId);await ready();assert.deepEqual(await ids(),[b,a,c]);
 await drag(a,b,false);await reordered([a,b,c]);
 for(let i=0;i<3;i++){await drag(a,c,true);await reordered([b,c,a]);await drag(a,b,false);await reordered([a,b,c]);}
 const stable=await evaluate(raw);await drag(a,c,true,{cancel:true});assert.deepEqual(await ids(),[a,b,c]);assert.deepEqual(await evaluate(raw),stable);
 // A title is an ordinary link and never starts the reorder controller.
 const title=await point('#authors h2 a');await chrome.send('Input.dispatchMouseEvent',{type:'mousePressed',...title,button:'left',buttons:1,clickCount:1},page.sessionId);await chrome.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:title.x+20,y:title.y+25,button:'left',buttons:1},page.sessionId);assert.equal(await evaluate("!!document.querySelector('#authors .reorder-dragging')"),false);await key('Escape');await chrome.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1200,y:20,button:'left',buttons:0},page.sessionId);
 await evaluate(`document.querySelector(${JSON.stringify(handle(a))}).focus()`);await key('End');await reordered([b,c,a]);
 assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(handle(a))})&&document.activeElement.matches(':focus-visible')`),true);await key('Home');await reordered([a,b,c]);await key('ArrowDown');await reordered([b,a,c]);
 assert.ok(await evaluate("document.querySelector('#reorder-status').textContent.includes('position 2')"));assert.equal(await evaluate("document.querySelector('#status').textContent"),'');
 const current=await evaluate(raw);assert.deepEqual(current.collections,sidebar);assert.deepEqual(current.authors,source.authors);assert.deepEqual(current.memberships,source.memberships);
 await select(seed.b);assert.deepEqual(await ids(),[a,b,global[3]]);await select('');assert.deepEqual(await ids(),global);await select(seed.a);assert.deepEqual(await ids(),[b,a,c]);
 await evaluate("document.querySelector('#filter').value='George';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");assert.equal(await evaluate("document.querySelector('#authors .reorder-handle').disabled"),true);await evaluate("document.querySelector('#filter').value='';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");assert.equal(await evaluate("document.querySelector('#authors .reorder-handle').disabled"),false);assert.deepEqual(await ids(),[b,a,c]);
 await select(seed.empty);assert.deepEqual(await ids(),[]);await select(seed.single);assert.deepEqual(await ids(),[a]);await evaluate(`document.querySelector(${JSON.stringify(handle(a))}).focus()`);await key('End');assert.deepEqual(await ids(),[a]);await select(seed.a);
 assert.equal((await chrome.send('Target.getTargets')).targetInfos.length,targetCount,'dragging must not navigate/open author tabs');
 await chrome.send('ServiceWorker.enable',{},page.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},page.sessionId);await chrome.send('Page.reload',{},page.sessionId);await ready();assert.deepEqual(await ids(),[b,a,c]);
 for(const width of [1280,360]){await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:false},page.sessionId);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await shot(`author-collection-${width}.png`);}
 const ax=await chrome.send('Accessibility.getFullAXTree',{},page.sessionId);assert.ok(ax.nodes.some(n=>n.role?.value==='button'&&n.name?.value==='Move George Dimitrov'));
 const backups=[];for(const [category,selection]of [['all',{kind:'all'}],['following',{kind:'all'}],['following',{kind:'collection',collectionId:seed.a}]])backups.push(await evaluate(rpc(`r.exportBackup(${JSON.stringify(category)},${JSON.stringify(selection)})`)));
 await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:extension})).id,id);await enabled();await open();assert.deepEqual(await ids(),[b,a,c]);assert.deepEqual((await evaluate(raw)).collections,sidebar);
 await chrome.close();
 for(let i=0;i<backups.length;i++){
  chrome=new ChromiumTestSession(join(tmp,`restore-${i}`));id=(await chrome.send('Extensions.loadUnpacked',{path:extension})).id;await open();const file=backups[i];await evaluate(rpc(`r.importBackup([{kind:${JSON.stringify(file.base64?'zip':'json')},data:${JSON.stringify(file.base64??file.text)}}])`));await evaluate(rpc('r.setOrganizeFollowedAuthorsIntoCollections(true)'));await open(seed.a);assert.deepEqual(await ids(),[b,a,c]);
  const restored=await evaluate(raw);assert.deepEqual(restored.authors,source.authors.filter(a=>restored.memberships.some(m=>m.authorId===a.id)));if(i<2)assert.deepEqual(restored.collections,sidebar);await chrome.close();
 }
 console.log(`AUTHOR COLLECTION REORDER PASS: enabled/hittable grab cursor, grabbing/insertion, repeated actual author drags up/down, cancellation, keyboard focus and hidden announcements, search/empty/single, global and overlapping collection isolation, metadata/membership/sidebar preservation, real same-version schema7→8 extension reload, worker/page/browser restart and full/section/collection backup restores; screenshots ${shots}`);
} finally {await chrome.close();await rm(tmp,{recursive:true,force:true});}
