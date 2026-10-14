import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession, waitFor } from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'xivary-offline-'));
const profile=join(temporary,'profile'), downloads=join(temporary,'downloads');await mkdir(downloads);
const screenshots='/tmp/xivary-offline-screenshots';await mkdir(screenshots,{recursive:true});
let chrome=new ChromiumTestSession(profile), extensionId, worker;
let workerVersions = [];
let downloadsStarted=0, requests=0, version=1, badPdf=false, large=false, interrupt=false, holdPdf=false, heldPdf;
const downloadsSeen = [];
const paper={arxivId:'2401.00001',title:'A compact offline research paper',authors:['Alex Kim'],categories:['cs.AI']};
const client=operation=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${operation};})()`;
// Real, valid one-page PDF with byte-correct xref; padding exercises large blob transport.
function pdfBytes(padding=0) {
  let text='%PDF-1.4\n';const offsets=[0];
  const content='BT /F1 20 Tf 40 150 Td (Offline native viewer) Tj ET';
  const objects=['<</Type/Catalog/Pages 2 0 R>>','<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',`<</Length ${content.length}>>\nstream\n${content}\nendstream`,'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  text+='%'+ ' '.repeat(padding)+'\n'; const start=Buffer.byteLength(text);
  text+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
  text+=`trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(text);
}
const abstract=id=>`<!doctype html><html><head><meta name="citation_title" content="A compact offline research paper"><meta name="citation_date" content="2024/01/01"></head><body><h1 class="title">Title: A compact offline research paper</h1><div class="authors"><a href="https://arxiv.org/search/?searchtype=author&query=Kim,+A">Alex Kim</a></div><span>arXiv:${id}v${version}</span><a href="https://arxiv.org/pdf/${id}v${version}">PDF</a></body></html>`;
async function intercept(session) {
  await chrome.send('Fetch.enable',{patterns:[{urlPattern:'https://arxiv.org/*'}]},session);
  const browser=chrome;
  browser.listeners.push(message=>{
    if(message.method!=='Fetch.requestPaused'||message.sessionId!==session)return;
    const url=new URL(message.params.request.url), isPdf=url.pathname.startsWith('/pdf/');
    if(isPdf)requests++;
    if(isPdf && holdPdf) { heldPdf = { requestId: message.params.requestId, session }; return; }
    if(isPdf && interrupt) { void browser.send("Fetch.failRequest",{requestId:message.params.requestId,errorReason:"ConnectionReset"},session).catch(()=>{}); return; }
    const body=isPdf ? (badPdf?Buffer.from('<html>error</html>'):pdfBytes(large?20*1024*1024:0)) : Buffer.from(abstract(url.pathname.slice(5).replace(/v\d+$/,'')));
    void browser.send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:isPdf?(badPdf?'text/html':'application/pdf'):'text/html'}],body:body.toString('base64')},session).catch(()=>{});
  });
}
async function attachWorker() {
  const target=await waitFor(async()=> (await chrome.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.includes(extensionId)), 'worker');
  worker=(await chrome.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  await chrome.send('Runtime.enable',{},worker);await intercept(worker);
}
async function library() { const p=await chrome.page(`chrome-extension://${extensionId}/src/library/library.html`);await chrome.until(p.sessionId,"!!document.querySelector('#count') && document.querySelector('#count').textContent.length > 0");return p; }
async function nativeViewer(page) {
  const sessions = new Map();
  return waitFor(async () => {
    const targets = (await chrome.send('Target.getTargets')).targetInfos.filter(t=>t.type==='iframe'&&t.url==='chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'&&t.parentId===page.targetId);
    for (const target of targets) {
      try {
        let session = sessions.get(target.targetId);
        if (!session) { session = (await chrome.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId; sessions.set(target.targetId,session); }
        if (await chrome.evaluate(session,"document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar')?.docLength === 1")) return session;
      } catch { sessions.delete(target.targetId); }
    }
    return false;
  }, 'Chrome native PDF viewer loaded one page', 30000);
}
async function shot(page,name) { await chrome.send('Page.bringToFront',{},page.sessionId);await chrome.evaluate(page.sessionId,'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');const data=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(screenshots,name),Buffer.from(data.data,'base64')); }
async function enableExtension() {
  const manager=await chrome.page('chrome://extensions/');await chrome.until(manager.sessionId,'!!chrome.management');
  await chrome.evaluate(manager.sessionId,`new Promise(resolve=>chrome.management.setEnabled('${extensionId}',true,resolve))`);
}
try {
  extensionId=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'extension')})).id;
  console.log((await chrome.send('Browser.getVersion')).product);
  chrome.listeners.push(message=>{if(message.method==='Browser.downloadWillBegin'){downloadsStarted++;downloadsSeen.push(message.params);}});
  await chrome.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  let lib=await library();await attachWorker();
  chrome.listeners.push(message => { if (message.method === 'ServiceWorker.workerVersionUpdated') workerVersions.push(...message.params.versions); });
  await chrome.send('ServiceWorker.enable',{},lib.sessionId);
  assert.equal(await chrome.evaluate(lib.sessionId,"document.querySelector('#offline-filter')"),null);
  assert.deepEqual(await chrome.evaluate(lib.sessionId,"[...document.querySelectorAll('.app-nav a')].map(a=>a.textContent)"),['Library','Following','Offline','Feed']);
  // Create v1 storage and migrate real IndexedDB, preserving data in the old stores.
  await chrome.evaluate(lib.sessionId,`(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('xivary-offline');r.onsuccess=resolve;r.onerror=reject;});await new Promise((resolve,reject)=>{const r=indexedDB.open('xivary-offline',1);r.onupgradeneeded=()=>{r.result.createObjectStore('copies',{keyPath:'arxivId'});r.result.createObjectStore('pdfs');};r.onsuccess=()=>{r.result.close();resolve();};r.onerror=reject;});})()`);
  await chrome.evaluate(lib.sessionId,`new Promise((resolve,reject)=>{const request=indexedDB.open('xivary-offline',1);request.onerror=reject;request.onsuccess=()=>{const db=request.result,tx=db.transaction(['copies','pdfs'],'readwrite');tx.objectStore('copies').put({arxivId:'2401.00003',version:1,versionedId:'2401.00003v1',savedAt:'2024-01-01T00:00:00Z',size:10,paper:${JSON.stringify({...paper,arxivId:'2401.00003'})}});tx.objectStore('pdfs').put(new Blob(['migration retained']),'2401.00003');tx.oncomplete=()=>{db.close();resolve();};};})`);
  const migrated=await chrome.evaluate(lib.sessionId,client("repository.getOfflineCopy('2401.00003')"));assert.equal(migrated.versionedId,'2401.00003v1');
  assert.equal(await chrome.evaluate(lib.sessionId,client("repository.getOfflinePdfChunk('2401.00003','2024-01-01T00:00:00Z',0)")),Buffer.from('migration retained').toString('base64'));
  await chrome.evaluate(lib.sessionId,client("repository.removeOfflineCopy('2401.00003')"));
  const abs=await chrome.page();await intercept(abs.sessionId);await chrome.send('Page.navigate',{url:'https://arxiv.org/abs/2401.00001v1'},abs.sessionId);
  try { await chrome.until(abs.sessionId,"document.querySelector('.offline-action')?.dataset.state==='empty'"); }
  catch (error) { console.log(await chrome.evaluate(abs.sessionId, "document.body.innerHTML")); throw error; }
  await chrome.click(abs.sessionId,'.offline-action');
  try { await chrome.until(abs.sessionId,"document.querySelector('.offline-action')?.dataset.state==='saved'"); }
  catch(error) { console.log(await chrome.evaluate(abs.sessionId,"document.querySelector('.offline-action').outerHTML"));console.log(await chrome.evaluate(lib.sessionId,client('repository.getOfflineLibrary()')));throw error; }
  assert.equal(downloadsStarted,0);assert.equal(requests,1);
  assert.equal((await chrome.evaluate(lib.sessionId,client('repository.listFavorites()'))).length,0);
  await chrome.send('Page.reload',{},lib.sessionId);await chrome.until(lib.sessionId,"document.querySelector('#count').textContent==='0 papers'");
  assert.equal(await chrome.evaluate(lib.sessionId,"document.querySelectorAll('.paper-row').length"),0);
  const off=await chrome.page(`chrome-extension://${extensionId}/src/offline/offline.html`);
  await chrome.until(off.sessionId,"document.querySelectorAll('.paper-row').length===1");
  assert.equal(await chrome.evaluate(off.sessionId,"document.querySelector('.bookmark').getAttribute('aria-pressed')"),'false');
  assert.equal(await chrome.evaluate(off.sessionId,"document.querySelector('.app-nav [aria-current]').textContent"),'Offline');
  await chrome.evaluate(off.sessionId,"document.querySelector('#filter').value='no match';document.querySelector('#filter').dispatchEvent(new Event('input'))");
  assert.equal(await chrome.evaluate(off.sessionId,"document.querySelectorAll('.paper-row').length"),0);
  await chrome.click(off.sessionId,'#clear-filter');assert.equal(await chrome.evaluate(off.sessionId,"document.querySelectorAll('.paper-row').length"),1);
  await shot(off,'offline-only.png');await shot(abs,'arxiv-offline.png');
  console.log('PASS: real fetch + IndexedDB migration, arXiv icon save without download event, offline-only Offline tab discovery; Library stays bookmark-only');
  await chrome.evaluate(lib.sessionId,client(`Promise.all([repository.saveOfflinePaper(${JSON.stringify(paper)}),repository.saveOfflinePaper(${JSON.stringify(paper)})])`));assert.equal(requests,1);
  await chrome.click(off.sessionId,'.bookmark');await chrome.until(off.sessionId,"document.querySelector('.bookmark').getAttribute('aria-pressed')==='true'");
  await chrome.send('Page.reload',{},lib.sessionId);await chrome.until(lib.sessionId,"document.querySelectorAll('.paper-row').length===1");
  assert.equal(await chrome.evaluate(lib.sessionId,"document.querySelectorAll('.paper-row').length"),1);
  await chrome.click(off.sessionId,'.paper-row h2 a');
  const readerTarget=await waitFor(async()=> (await chrome.send('Target.getTargets')).targetInfos.find(t=>t.url.includes('/offline/read.html?')),'reader tab');
  const reader={targetId:readerTarget.targetId,sessionId:(await chrome.send('Target.attachToTarget',{targetId:readerTarget.targetId,flatten:true})).sessionId};await chrome.send('Page.enable',{},reader.sessionId);await nativeViewer(reader);await shot(reader,'native-viewer.png');
  await chrome.send('Network.enable',{},reader.sessionId);await chrome.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},reader.sessionId);
  await chrome.send('Network.enable',{},worker);await chrome.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},worker);
  await chrome.send('Page.reload',{},reader.sessionId);await nativeViewer(reader);assert.equal(requests,1);assert.equal(downloadsStarted,0);
  console.log('PASS: actual native PDF viewer renders one page, new tab, reload with worker and reader network disabled');
  const workerVersion = await waitFor(() => workerVersions.find(item=>item.scriptURL?.includes(extensionId) && item.status==='activated'), 'extension worker version');
  const workerTarget = (await chrome.send('Target.getTargets')).targetInfos.find(item=>item.type==='service_worker'&&item.url.includes(extensionId));
  await chrome.send('Target.detachFromTarget',{sessionId:worker});
  await chrome.send('ServiceWorker.stopWorker',{versionId:workerVersion.versionId},lib.sessionId);
  await waitFor(async()=>!(await chrome.send('Target.getTargets')).targetInfos.some(item=>item.targetId===workerTarget.targetId),'offline worker stopped');
  await nativeViewer(reader);
  await chrome.send('Page.reload',{},reader.sessionId);await nativeViewer(reader);assert.equal(requests,1);
  await attachWorker();
  console.log('PASS: document-owned native viewer survives explicit worker suspension; reader reload wakes worker using local bytes');
  version=2;badPdf=true;
  const before=await chrome.evaluate(lib.sessionId,client(`repository.getOfflineCopy('${paper.arxivId}')`));
  const error=await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify(paper)},true).catch(e=>e.message)`));assert.match(error,/PDF/);
  assert.deepEqual(await chrome.evaluate(lib.sessionId,client(`repository.getOfflineCopy('${paper.arxivId}')`)),before);
  badPdf=false;const updated=await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify(paper)},true)`));assert.equal(updated.version,2);
  version=3;holdPdf=true;
  await chrome.until(abs.sessionId,"document.querySelector('.offline-action').dataset.state==='saved'");
  await chrome.click(abs.sessionId,'.offline-action');await chrome.until(abs.sessionId,"!!document.querySelector('.offline-menu')");
  await chrome.evaluate(abs.sessionId,"[...document.querySelectorAll('.offline-menu button')].find(button=>button.textContent==='Update offline copy').click()");
  await waitFor(()=>heldPdf,'held PDF fetch');await chrome.until(abs.sessionId,"document.querySelector('.offline-action').dataset.state==='saving'");
  await chrome.click(abs.sessionId,'.offline-action');await chrome.evaluate(abs.sessionId,"[...document.querySelectorAll('.offline-menu button')].find(button=>button.textContent==='Cancel offline save').click()");
  await chrome.until(abs.sessionId,"document.querySelector('.offline-action').dataset.state==='error'");
  assert.deepEqual(await chrome.evaluate(lib.sessionId,client(`repository.getOfflineCopy('${paper.arxivId}')`)),updated);
  holdPdf=false;await chrome.send('Fetch.failRequest',{requestId:heldPdf.requestId,errorReason:'Aborted'},heldPdf.session).catch(()=>{});heldPdf=null;
  console.log('PASS: small saving indicator, contextual cancellation, error state and prior-copy preservation');
  await chrome.evaluate(worker,"globalThis.originalOfflinePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='pdfs')throw new DOMException('fixture quota','QuotaExceededError');return originalOfflinePut.apply(this,args);}");
  try {
    const quota = await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify(paper)},true).catch(error=>error.message)`));assert.match(quota,/storage is full/);
    assert.deepEqual(await chrome.evaluate(lib.sessionId,client(`repository.getOfflineCopy('${paper.arxivId}')`)),updated);
  } finally { await chrome.evaluate(worker,"IDBObjectStore.prototype.put=originalOfflinePut;delete globalThis.originalOfflinePut");version=2; }
  console.log('PASS: injected quota failure aborts real IndexedDB replacement, retaining metadata and prior PDF');
  large=true;const legacy={...paper,arxivId:'hep-th/9901001v1',title:'Large legacy PDF'};
  await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify(legacy)})`));large=false;
  const big=await chrome.page(`chrome-extension://${extensionId}/src/offline/read.html?id=hep-th%2F9901001`);await nativeViewer(big);await shot(big,'native-large.png');
  console.log('PASS: duplicate saves, explicit version update, invalid replacement preserves old copy, legacy ID and 20 MiB native rendering');
  const bookmarks=await chrome.evaluate(lib.sessionId,client('repository.getPaperLibrary()'));
  await chrome.evaluate(lib.sessionId,client(`repository.removeOfflineCopy('${paper.arxivId}')`));
  assert.deepEqual(await chrome.evaluate(lib.sessionId,client('repository.getPaperLibrary()')),bookmarks);
  await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify({...paper,versionedId:'2401.00001v2'})})`));
  await chrome.evaluate(lib.sessionId,client(`repository.removeFavorite('${paper.arxivId}')`));assert.ok(await chrome.evaluate(lib.sessionId,client(`repository.getOfflineCopy('${paper.arxivId}')`)));
  const settings=await chrome.page(`chrome-extension://${extensionId}/src/settings/settings.html`);await chrome.until(settings.sessionId,"document.querySelector('#offline-usage').textContent.includes('2 offline papers')");
  await chrome.evaluate(settings.sessionId,"document.querySelector('#offline-storage').scrollIntoView({block:'center'})");
  await shot(settings,'settings-storage.png');
  await chrome.send('Page.reload',{},off.sessionId);await chrome.until(off.sessionId,"document.querySelectorAll('.paper-row').length===2");
  await chrome.click(off.sessionId,'.offline-action');await chrome.until(off.sessionId,"!!document.querySelector('.offline-menu')");
  assert.equal(await chrome.evaluate(off.sessionId,"[...document.querySelectorAll('.offline-menu button')].some(b=>b.textContent==='Export PDF')"),true);
  await chrome.evaluate(off.sessionId,"[...document.querySelectorAll('.offline-menu button')].find(b=>b.textContent==='Remove offline copy…').click()");
  assert.equal((await chrome.evaluate(lib.sessionId,client('repository.getOfflineLibrary()'))).count,2);
  await chrome.evaluate(off.sessionId,"[...document.querySelectorAll('.offline-menu button')].find(b=>b.textContent==='Confirm removal').click()");
  await chrome.until(settings.sessionId,"document.querySelector('#offline-usage').textContent.includes('1 offline paper')");
  await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify({...paper,versionedId:'2401.00001v2'})})`));
  interrupt=true;
  const interrupted=await chrome.evaluate(lib.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify({...paper,arxivId:'2401.00002v1'})}).catch(error=>error.message)`));
  assert.match(interrupted,/fetch|network/i);assert.equal(await chrome.evaluate(lib.sessionId,client("repository.getOfflineCopy('2401.00002')")),null);interrupt=false;
  await chrome.send('Page.reload',{},off.sessionId);await chrome.until(off.sessionId,"document.querySelectorAll('.paper-row').length===2");
  await chrome.click(off.sessionId,'.offline-action');await chrome.until(off.sessionId,"!!document.querySelector('.offline-menu')");await shot(off,'offline-context-menu.png');
  await chrome.evaluate(off.sessionId,"[...document.querySelectorAll('.offline-menu button')].find(button=>button.textContent==='Export PDF').click()");
  await waitFor(()=>downloadsSeen.length===1,'explicit PDF export');assert.match(downloadsSeen[0].suggestedFilename,/2401.00001v2\.pdf/);
  console.log('PASS: interrupted network leaves no copy; only explicit secondary export starts a download');
  console.log('PASS: bookmark independence in both directions, compact Settings count/size, secondary export action, two-activation removal');
  const snapshot=await chrome.evaluate(lib.sessionId,client('repository.getOfflineLibrary()'));
  await chrome.send('Runtime.evaluate',{expression:'setTimeout(()=>chrome.runtime.reload(),50)'},lib.sessionId);
  await waitFor(async()=> (await chrome.send('Extensions.getExtensions')).extensions.some(e=>e.id===extensionId&&!e.enabled),'extension reload');await enableExtension();
  lib=await library();assert.deepEqual((await chrome.evaluate(lib.sessionId,client('repository.getOfflineLibrary()'))).copies,snapshot.copies);
  await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:join(root,'extension')})).id,extensionId);await waitFor(async()=> (await chrome.send('Extensions.getExtensions')).extensions.some(e=>e.id===extensionId),'profile restored');await enableExtension();lib=await library();
  assert.deepEqual((await chrome.evaluate(lib.sessionId,client('repository.getOfflineLibrary()'))).copies,snapshot.copies);
  const restarted=await chrome.page(`chrome-extension://${extensionId}/src/offline/read.html?id=2401.00001`);await nativeViewer(restarted);
  console.log('PASS: PDF blobs and metadata survive extension reload and full Chrome/profile restart; native viewer still renders');
  console.log(`OFFLINE SMOKE PASS; screenshots: ${screenshots}; no account, no production network`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}
