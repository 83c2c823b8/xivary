import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession,waitFor } from './chromium-test-session.mjs';
import { readBackupZip } from '../extension/src/repository/backup-zip.js';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-backup-browser-')),downloadsPath=join(temporary,'downloads');
await mkdir(downloadsPath);const screenshots='/tmp/xivary-backup-screenshots';await mkdir(screenshots,{recursive:true});
let chrome=new ChromiumTestSession(join(temporary,'source')),extensionId,settings;
const client=expression=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${expression};})()`;
const paper=i=>({arxivId:`2610.${String(i).padStart(5,'0')}`,title:`My renamed paper ${i} — 猫`,authors:['Alex Kim'],publishedAt:'2026-10-14T00:00:00Z',tags:['Geometry'],note:'Stored user metadata'});
async function start(){extensionId=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;settings=await chrome.page(`chrome-extension://${extensionId}/src/settings/settings.html`);await chrome.until(settings.sessionId,"document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");}
async function snapshot(){return chrome.evaluate(settings.sessionId,client(`Promise.all([repository.getPaperLibrary(),repository.getAuthorLibrary(),repository.getPreferences()])`));}
function owned(snapshot){const [library,authors]=snapshot;return {papers:library.papers,ordering:library.ordering,collections:[...library.collections].sort((a,b)=>a.id.localeCompare(b.id)),memberships:[...library.memberships].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),authors:authors.authors,authorCollections:authors.collections,authorMemberships:authors.memberships};}
async function shot(page,name){const {data}=await chrome.send('Page.captureScreenshot',{},page.sessionId);await writeFile(join(screenshots,name),Buffer.from(data,'base64'));}
async function importFiles(paths){let chooser;const session=settings.sessionId;const listener=message=>{if(message.method==='Page.fileChooserOpened'&&message.sessionId===session)chooser=message.params;};chrome.listeners.push(listener);await chrome.send('Page.setInterceptFileChooserDialog',{enabled:true},session);await chrome.click(session,'[data-import=all]');await waitFor(()=>chooser,'file chooser');await chrome.send('DOM.setFileInputFiles',{files:paths,backendNodeId:chooser.backendNodeId},session);await chrome.until(session,"!document.querySelector('[data-import=all]').disabled && /imported|failed/.test(document.querySelector('#status').textContent)");chrome.listeners.splice(chrome.listeners.indexOf(listener),1);assert.equal(await chrome.evaluate(session,"document.querySelector('#status').classList.contains('error')"),false,await chrome.evaluate(session,"document.querySelector('#status').textContent"));}
try {
  await start();console.log((await chrome.send('Browser.getVersion')).product);
  const ids=await chrome.evaluate(settings.sessionId,client(`(async()=>{
    for(const p of ${JSON.stringify([paper(1),paper(2),paper(3)])})await repository.savePaper(p);
    const a=await repository.createPaperCollection('My Geometry',${JSON.stringify(paper(1))}),b=await repository.createPaperCollection('研究 / Second',${JSON.stringify(paper(1))});
    for(const collection of [a,b])for(const p of ${JSON.stringify([paper(2),paper(3)])})await repository.addPaperToCollection(p,collection.id);
    await repository.movePaperCollection(b.id,a.id);await repository.movePaperInCollection(a.id,'2610.00003','2610.00001');
    await repository.followAuthor({displayName:'Renée Smith'});await repository.followAuthor({displayName:'Alex Kim'});
    const author=(await repository.listFollowing())[0];
    const files=[await repository.exportBackup('bookmarks',{kind:'record',id:'2610.00001'}),await repository.exportBackup('following',{kind:'record',id:author.id})];
    const documents=files.map(file=>JSON.parse(file.text));
    documents[0].records.find(item=>item.type==='bookmark').record.originalTitle='Original metadata title';
    documents[0].records.find(item=>item.type==='bookmark').record.customTitle='My renamed paper 1 — 猫';
    documents[1].records.find(item=>item.type==='following').record.alias='My advisor / 先生';
    await repository.importBackup(documents.map(doc=>({kind:'json',data:JSON.stringify(doc)})),'all');
    return {a:a.id,b:b.id};})()`));
  const before=await snapshot(),downloads=new Map();
  chrome.listeners.push(message=>{if(message.method==='Browser.downloadWillBegin')downloads.set(message.params.guid,{...message.params});if(message.method==='Browser.downloadProgress')Object.assign(downloads.get(message.params.guid)||{},message.params);});
  await chrome.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:downloadsPath,eventsEnabled:true});
  await chrome.click(settings.sessionId,'[data-export=all]');await chrome.until(settings.sessionId,"document.querySelector('#export-dialog').open");await chrome.click(settings.sessionId,'#confirm-export');
  const download=await waitFor(()=>[...downloads.values()].find(item=>item.state==='completed'),'one full backup download');assert.equal(downloads.size,1);assert.match(download.suggestedFilename,/\.zip$/);
  const archivePath=join(downloadsPath,download.guid),files=await readBackupZip(new Uint8Array(await readFile(archivePath)));
  assert.equal(files.filter(f=>f.path.includes('/bookmarks/')).length,3);assert.equal(files.filter(f=>f.path.includes('/following/')).length,2);
  assert.equal(files.some(f=>/offline|feed|sync/i.test(f.path)),false);
  await shot(settings,'source-settings.png');await chrome.close();chrome=new ChromiumTestSession(join(temporary,'destination'));await start();
  assert.equal((await snapshot())[0].papers.length,0);
  // Save an independent Offline copy through the real repository before import.
  const workerTarget=await waitFor(async()=> (await chrome.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.includes(extensionId)),'worker');
  const worker=(await chrome.send('Target.attachToTarget',{targetId:workerTarget.targetId,flatten:true})).sessionId;
  await chrome.send('Fetch.enable',{patterns:[{urlPattern:'*arxiv.org/*'}]},worker);let requests=0;
  const pdf='%PDF-1.4\nPortable-backup PDF byte retention fixture\n%%EOF\n';
  let apiRequests=0;
  const atom='<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>0</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>0</opensearch:itemsPerPage></feed>';
  chrome.listeners.push(message=>{if(message.method==='Fetch.requestPaused'&&message.sessionId===worker){
    const api=message.params.request.url.includes('/api/query');if(api)apiRequests++;else requests++;
    void chrome.send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:api?'application/atom+xml':'application/pdf'}],body:Buffer.from(api?atom:pdf).toString('base64')},worker);
  }});
  const offline={...paper(9),arxivId:'2610.99999',versionedId:'2610.99999v1'};
  await chrome.evaluate(settings.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify(offline)})`));
  const offlineBefore=await chrome.evaluate(settings.sessionId,client("(await repository.readOfflinePdf('2610.99999')).blob.text()"));assert.equal(offlineBefore,pdf);assert.equal(requests,1);
  const syncBefore=await chrome.evaluate(settings.sessionId,"chrome.storage.sync.get(null)");
  await importFiles([archivePath]);assert.deepEqual(owned(await snapshot()),owned(before));
  assert.deepEqual(await chrome.evaluate(settings.sessionId,client("(await repository.readOfflinePdf('2610.99999')).blob.text()")),offlineBefore);
  assert.equal(requests,1);assert.equal(apiRequests,0);assert.deepEqual(await chrome.evaluate(settings.sessionId,'chrome.storage.sync.get(null)'),syncBefore);
  assert.deepEqual((await snapshot())[2],{openArxivLinksInNewTab:false,organizeFollowedAuthorsIntoCollections:false,openAuthorResultsInNewTab:true,openXivaryFromToolbarInNewTab:true,vimMode:false,renderLatexInAbstracts:true,customLatexMacros:''});
  await importFiles([archivePath]);assert.deepEqual(owned(await snapshot()),owned(before));
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:false},settings.sessionId);await chrome.evaluate(settings.sessionId,"document.querySelector('#data').scrollIntoView()");assert.equal(await chrome.evaluate(settings.sessionId,'document.documentElement.scrollWidth<=innerWidth'),true);await shot(settings,'destination-settings-360.png');
  const library=await chrome.page(`chrome-extension://${extensionId}/src/library/library.html`);await chrome.until(library.sessionId,"document.querySelectorAll('.paper-row').length===3");
  assert.deepEqual(await chrome.evaluate(library.sessionId,"[...document.querySelectorAll('.collection-link')].slice(1).map(node=>node.dataset.collectionId)"),before[0].ordering.collectionIds);
  await chrome.click(library.sessionId,`.collection-link[data-collection-id="${ids.a}"]`);assert.deepEqual(await chrome.evaluate(library.sessionId,"[...document.querySelectorAll('.paper-row h2 a')].map(a=>a.href.split('/abs/')[1])"),['2610.00003','2610.00001','2610.00002']);
  await chrome.click(library.sessionId,'.paper-row .bookmark');await chrome.until(library.sessionId,"!!document.querySelector('.arxiv-collection-picker')");
  const following=await chrome.page(`chrome-extension://${extensionId}/src/authors/authors.html`);await chrome.until(following.sessionId,"document.querySelectorAll('.author-row').length===2");
  const offlinePage=await chrome.page(`chrome-extension://${extensionId}/src/offline/offline.html`);await chrome.until(offlinePage.sessionId,"document.querySelectorAll('.paper-row').length===1");
  const feed=await chrome.page(`chrome-extension://${extensionId}/src/feed/feed.html`);
  await chrome.until(feed.sessionId,"!document.querySelector('#refresh').disabled && !document.querySelector('#empty').hidden && document.querySelector('#empty').textContent.includes('No recent papers')",30000);
  assert.ok(apiRequests>0);assert.equal(await chrome.evaluate(feed.sessionId,"document.querySelector('#status').classList.contains('error')"),false);
  await chrome.close();chrome=new ChromiumTestSession(join(temporary,'destination'));await start();assert.deepEqual(owned(await snapshot()),owned(before));
  console.log(`BACKUP PASS: native Export All single ZIP and clean-profile file chooser import, custom titles/alias metadata, Unicode/shared memberships/exact ordering, idempotence, no arXiv restore requests or Sync writes, independent Offline PDF bytes, normal Library/Following/Feed/Offline operations, 360px Settings, profile restart; screenshots ${screenshots}`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}
