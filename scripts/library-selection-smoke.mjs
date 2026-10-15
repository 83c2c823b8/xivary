import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession } from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-library-selection-')),profile=join(temporary,'profile');
const shots='/tmp/xivary-library-selection-screenshots';await mkdir(shots,{recursive:true});
let chrome=new ChromiumTestSession(profile),id,page;
const client=code=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const r=new RepositoryClient();return ${code};})()`;
const library=()=>`chrome-extension://${id}/src/library/library.html`;
const ready=()=>chrome.until(page.sessionId,"!!document.querySelector('#count')?.textContent&&document.querySelector('#filter')?.disabled===false");
const selected=()=>chrome.evaluate(page.sessionId,"document.querySelector('.collection-link[aria-current=page]').dataset.collectionId");
async function open(url=library()) {
 page=await chrome.page();
 await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.librarySelections=[];new MutationObserver(()=>{if(location.pathname.endsWith('/library/library.html')){const n=document.querySelector('.collection-link[aria-current=page]');if(n)window.librarySelections.push(n.dataset.collectionId)}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current']})`},page.sessionId);
 await chrome.send('Page.navigate',{url},page.sessionId);await ready();
}
async function select(value) {
 await chrome.click(page.sessionId,`.collection-link[data-collection-id="${value}"]`);
 await chrome.until(page.sessionId,`document.querySelector('.collection-link[aria-current]').dataset.collectionId===${JSON.stringify(value)}`);
 await chrome.until(page.sessionId,client(`(await r.getPaperLibrary()).selectedCollectionId===${JSON.stringify(value)}`));
}
async function first(value) {assert.equal(await selected(),value);assert.equal(await chrome.evaluate(page.sessionId,`window.librarySelections.every(id=>id===${JSON.stringify(value)})`),true,'no intermediate aggregate selection');}
const raw="chrome.storage.local.get('arxivResearchLibrary').then(v=>v.arxivResearchLibrary)";
try {
 id=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;await open();
 console.log((await chrome.send('Browser.getVersion')).product);await first('');
 const collections=await chrome.evaluate(page.sessionId,client(`(async()=>{const a=await r.createPaperCollection('Selection A'),b=await r.createPaperCollection('Selection B');for(let i=1;i<=3;i++)await r.addPaperToCollection({arxivId:'2610.0000'+i,title:'Selection paper '+i,authors:['Alex Kim'],publishedAt:'2026-10-01T00:00:00Z'},a.id);return {a:a.id,b:b.id};})()`));
 await chrome.send('Page.reload',{},page.sessionId);await ready();const owner=await chrome.evaluate(page.sessionId,raw);
 await select(collections.a);assert.deepEqual(await chrome.evaluate(page.sessionId,raw),owner,'selection changes no research records/preferences/order');
 await chrome.click(page.sessionId,'.app-nav a[href*="authors/"]');await chrome.until(page.sessionId,"document.querySelector('#authors')&&document.querySelector('#count')?.textContent==='0 authors'");
 await chrome.click(page.sessionId,'.app-nav a[href*="library/"]');await ready();await first(collections.a);
 // Search and publication filters explicitly remain transient.
 await chrome.evaluate(page.sessionId,"document.querySelector('#filter').value='paper 2';document.querySelector('#filter').dispatchEvent(new Event('input',{bubbles:true}))");
 await chrome.click(page.sessionId,'#date-range');await chrome.click(page.sessionId,'.time-menu [data-range=year]');
 await chrome.send('Page.reload',{},page.sessionId);await ready();await first(collections.a);
 assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('#filter').value===''&&document.querySelector('#range-label').textContent==='Any time'"),true);
 const closed=page.targetId;await chrome.send('Target.closeTarget',{targetId:closed});await open();await first(collections.a);
 await chrome.evaluate(page.sessionId,client(`r.renamePaperCollection(${JSON.stringify(collections.a)},'Renamed — 猫')`));await chrome.send('Page.reload',{},page.sessionId);await ready();await first(collections.a);
 const order=(await chrome.evaluate(page.sessionId,client('r.getPaperLibrary()'))).ordering;
 // Preserve actual collection and paper reordering while remembering the selection.
 await chrome.evaluate(page.sessionId,`document.querySelector('[data-reorder-handle="${collections.a}"]').focus()`);
 for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key:'End',code:'End'},page.sessionId);
 await chrome.until(page.sessionId,"document.querySelector('#status').textContent.includes('position 3')&&!document.querySelector('#filter').disabled");assert.equal(await selected(),collections.a);
 await chrome.evaluate(page.sessionId,"document.querySelector('#papers .reorder-handle').focus()");for(const type of ['keyDown','keyUp'])await chrome.send('Input.dispatchKeyEvent',{type,key:'End',code:'End'},page.sessionId);
 await chrome.until(page.sessionId,"document.querySelector('#status').textContent.includes('position 3 of 3')&&!document.querySelector('#filter').disabled");
 const changed=(await chrome.evaluate(page.sessionId,client('r.getPaperLibrary()'))).ordering;assert.notDeepEqual(changed,order);
 await chrome.send('ServiceWorker.enable',{},page.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},page.sessionId);await chrome.send('Page.reload',{},page.sessionId);await ready();await first(collections.a);
 await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id,id);await open();await first(collections.a);
 assert.deepEqual((await chrome.evaluate(page.sessionId,client('r.getPaperLibrary()'))).ordering,changed);
 await select('');await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');
 // Explicit routes, including aggregate, take precedence over the stored preference.
 await select(collections.a);await open(library()+`?collectionId=${encodeURIComponent(collections.b)}`);await first(collections.b);
 await chrome.until(page.sessionId,client(`(await r.getPaperLibrary()).selectedCollectionId===${JSON.stringify(collections.b)}`));
 await open(library()+'?collectionId=');await first('');await select(collections.b);await open();await first(collections.b);
 await chrome.click(page.sessionId,`.collection-link[data-collection-id="${collections.b}"] + .collection-more`);await chrome.click(page.sessionId,'.collection-menu [data-action=delete]');await chrome.click(page.sessionId,'.collection-delete-dialog .button-danger');
 await chrome.until(page.sessionId,"!document.querySelector('.collection-delete-dialog')&&document.querySelector('.collection-link[aria-current]').dataset.collectionId===''");await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');
 for(const value of [{version:1,collectionId:'paper-collection:stale'},null,{version:1,collectionId:123}]){
  await chrome.evaluate(page.sessionId,`chrome.storage.local.set({'xivary:library-selection':${JSON.stringify(value)}})`);
  await chrome.send('Page.reload',{},page.sessionId);await ready();await first('');
 }
 await select(collections.a);await chrome.send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:false},page.sessionId);
 assert.equal(await chrome.evaluate(page.sessionId,'document.documentElement.scrollWidth<=innerWidth'),true);
 const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(shots,'library-360.png'),Buffer.from(data,'base64'));
 assert.equal(await chrome.evaluate(page.sessionId,"document.querySelector('#status').textContent"),'');
 console.log(`LIBRARY SELECTION PASS: native tab switching, close/reopen, worker and full browser restart, first-render selection without aggregate flicker, stable IDs through rename, All Saved, explicit routes, selected deletion/stale/malformed fallback, collection/paper ordering preservation, transient filters and 360px layout; screenshots ${shots}`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}
