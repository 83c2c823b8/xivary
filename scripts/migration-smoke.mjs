import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ChromiumTestSession,waitFor } from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-storage-upgrade-'));
const extension=join(temporary,'extension'),profile=join(temporary,'profile'),screenshots='/tmp/xivary-migration-screenshots';await mkdir(screenshots,{recursive:true});
execFileSync('tar',['-x','-C',temporary],{input:execFileSync('git',['archive','f8a3e44','extension'],{cwd:root,maxBuffer:30*1024*1024})});
const releaseVersion=JSON.parse(await readFile(join(root,'extension/manifest.json'),'utf8')).version;
// Exercise a schema upgrade with an unchanged manifest version, independently
// of the release number. Only this disposable historical fixture is modified.
const previousManifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
previousManifest.version=releaseVersion;await writeFile(join(extension,'manifest.json'),JSON.stringify(previousManifest));
let chrome=new ChromiumTestSession(profile),id,settings;
const client=expression=>`(async()=>{const {RepositoryClient}=await import('../repository/repository-client.js');const repository=new RepositoryClient();return ${expression};})()`;
const state="chrome.storage.local.get('arxivResearchLibrary').then(values=>values.arxivResearchLibrary)";
const paper=i=>({arxivId:`2610.${String(i).padStart(5,'0')}`,title:`My upgrade title ${i} — 猫`,authors:['Alex Kim'],note:'Existing research annotation',tags:['Geometry'],abstract:'Upgrade metadata fixture.',categories:['math.SG'],publishedAt:new Date(Date.now()-60000).toISOString()});
function owner(s){return Object.fromEntries(['favorites','authors','paperCollections','collections','paperMemberships','memberships','settings','paperOrdering','followingFeedCache','customSortPreference'].filter(key=>Object.hasOwn(s,key)).map(key=>[key,s[key]]));}
async function page(path){const p=await chrome.page(`chrome-extension://${id}/src/${path}`);await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false},p.sessionId);return p;}
async function settingsPage(){settings=await page('settings/settings.html');await chrome.until(settings.sessionId,"document.readyState==='complete' && document.querySelector('#open-arxiv-new-tab') && !document.querySelector('#open-arxiv-new-tab').disabled");}
async function enable(){if((await chrome.send('Extensions.getExtensions')).extensions.find(item=>item.id===id)?.enabled)return;const manager=await chrome.page('chrome://extensions/');await chrome.until(manager.sessionId,'!!chrome.management');assert.equal(await chrome.evaluate(manager.sessionId,`new Promise(resolve=>chrome.management.setEnabled(${JSON.stringify(id)},true,()=>resolve(chrome.runtime.lastError?.message??'enabled')))`),'enabled');}
async function reloadExtension(){
  await chrome.send('Runtime.evaluate',{expression:'setTimeout(()=>chrome.runtime.reload(),50)'},settings.sessionId);
  await waitFor(async()=> (await chrome.send('Extensions.getExtensions')).extensions.some(item=>item.id===id&&!item.enabled),'actual unchanged-version extension reload');
  assert.equal((await chrome.send('Extensions.loadUnpacked',{path:extension})).id,id);await enable();await settingsPage();
}
async function shot(p,name){const {data}=await chrome.send('Page.captureScreenshot',{},p.sessionId);await writeFile(join(screenshots,name),Buffer.from(data,'base64'));}
async function copied(from,path){await mkdir(join(extension,path,'..'),{recursive:true});await cp(join(from,path),join(extension,path));}
const pdf='%PDF-1.4\nUpgrade preservation byte fixture\n%%EOF\n';
try {
  id=(await chrome.send('Extensions.loadUnpacked',{path:extension})).id;await settingsPage();console.log((await chrome.send('Browser.getVersion')).product);
  const papers=[paper(1),paper(2)];
  const collections=await chrome.evaluate(settings.sessionId,client(`(async()=>{
    for(const p of ${JSON.stringify(papers)})await repository.savePaper(p);
    const a=await repository.createPaperCollection('My Geometry',${JSON.stringify(papers[0])}),b=await repository.createPaperCollection('Research / Second',${JSON.stringify(papers[0])});
    await repository.addPaperToCollection(${JSON.stringify(papers[1])},a.id);await repository.addPaperToCollection(${JSON.stringify(papers[1])},b.id);
    await repository.followAuthor({displayName:'Alex Kim'});await repository.followAuthor({displayName:'Renée Smith'});
    await repository.setCustomLatexMacros(${JSON.stringify(String.raw`\Hom = \operatorname{Hom}`)});
    return {a:a.id,b:b.id};})()`));
  const original=await chrome.evaluate(settings.sessionId,state);assert.equal(original.schemaVersion,5);
  const raw=await chrome.evaluate(settings.sessionId,`chrome.runtime.sendMessage({channel:'arxiv-library:repository:v1',method:'getPaperLibrary',args:[]})`);assert.equal(raw.result.ordering,undefined);
  // A real old worker + new UI file mismatch reproduces the user's exact crash.
  for(const path of ['src/library/library.js','src/library/library.css','src/library/library.html','src/ui/reorder.js','src/ui/reorder.css','src/ui/collection-sidebar.js','src/domain/paper-ordering.js','src/domain/library-selection.js','src/domain/library-snapshot.js','src/repository/repository-client.js','src/repository/paper-repository.js'])await copied(join(root,'extension'),path);
  const clientPath=join(extension,'src/repository/repository-client.js'),currentClient=await readFile(clientPath,'utf8');
  const currentMethod='async getPaperLibrary() { return normalizeLibrarySnapshot(await this.request("getPaperLibrary")); }';
  assert.ok(currentClient.includes(currentMethod),'current response adapter fixture');
  await writeFile(clientPath,currentClient.replace(currentMethod,'getPaperLibrary() { return this.request("getPaperLibrary"); }'));
  const broken=await page('library/library.html');await chrome.until(broken.sessionId,"document.querySelector('#status').textContent.includes(\"reading 'collectionIds'\")");await shot(broken,'legacy-contract-crash.png');
  assert.deepEqual(owner(await chrome.evaluate(settings.sessionId,state)),owner(original));
  // Repair only the response contract while leaving the old worker/data in place.
  for(const path of ['src/repository/repository-client.js','src/repository/paper-repository.js','src/domain/library-snapshot.js'])await copied(join(root,'extension'),path);
  let library=await page('library/library.html');await chrome.until(library.sessionId,"document.querySelectorAll('.paper-row').length===2");assert.equal(await chrome.evaluate(library.sessionId,"document.querySelector('#status').classList.contains('error')"),false);await shot(library,'legacy-contract-recovered.png');
  assert.equal((await chrome.evaluate(settings.sessionId,state)).schemaVersion,5);
  // Seed realistic user-owned extras, manual orders and a valid retained Feed.
  await chrome.evaluate(settings.sessionId,`(async()=>{const {BrowserLocalStorage}=await import('../lib/storage.js');const disk=new BrowserLocalStorage(),s=await disk.read();
    s.favorites[0].customTitle=s.favorites[0].title;s.favorites[0].originalTitle='Original arXiv title';s.favorites[0].userMetadata={label:'My private annotation'};
    s.authors[1].alias='My advisor / 先生';s.authors[1].aliases=['R. Smith'];s.customSortPreference='retain existing local choice';
    s.paperOrdering={version:1,collectionIds:[${JSON.stringify(collections.b)},'paper-collection:saved-papers',${JSON.stringify(collections.a)}],paperOrders:[{collectionId:${JSON.stringify(collections.a)},paperIds:['2610.00002','2610.00001']}]};
    await disk.write(s);})()`);
  await chrome.evaluate(settings.sessionId,client(`(async()=>{
    const {emptyQueue,mergeQueue}=await import('../feed/queue.js');const authors=await repository.listFollowing(),alex=authors.find(a=>a.displayName==='Alex Kim');
    const candidate={...${JSON.stringify(paper(3))},reason:{source:'following',label:'Following: Alex Kim',detail:'Name-based fixture match; namesakes possible.',provenance:{followedIds:[alex.id],evidence:[]}}};
    await repository.putFollowingFeedCache(mergeQueue(emptyQueue(),[candidate],authors,[],{now:Date.now()}).queue);})()`));
  const workerTarget=await waitFor(async()=> (await chrome.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.includes(id)),'old worker');
  const worker=(await chrome.send('Target.attachToTarget',{targetId:workerTarget.targetId,flatten:true})).sessionId;
  await chrome.send('Fetch.enable',{patterns:[{urlPattern:'https://arxiv.org/*'}]},worker);
  chrome.listeners.push(message=>{if(message.method==='Fetch.requestPaused'&&message.sessionId===worker)void chrome.send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/pdf'}],body:Buffer.from(pdf).toString('base64')},worker);});
  await chrome.evaluate(settings.sessionId,client(`repository.saveOfflinePaper(${JSON.stringify({...papers[0],versionedId:'2610.00001v1'})})`));
  const before=await chrome.evaluate(settings.sessionId,state),offlineBefore=await chrome.evaluate(settings.sessionId,client("repository.getOfflineCopy('2610.00001')"));
  await rm(extension,{recursive:true});await cp(join(root,'dist/chromium'),extension,{recursive:true});
  await reloadExtension();
  assert.equal(await chrome.evaluate(settings.sessionId,'chrome.runtime.getManifest().version'),releaseVersion);
  const initialized=await chrome.evaluate(settings.sessionId,client('repository.initialize()'));assert.equal(initialized.schemaVersion,8);
  const after=await chrome.evaluate(settings.sessionId,state);assert.equal(after.schemaVersion,8);
  const expected=structuredClone(before),live=new Set(before.memberships.map(m=>m.authorId));let next=0;
  const ordered=before.authors.filter(a=>live.has(a.id)).sort((a,b)=>b.followedAt.localeCompare(a.followedAt));
  expected.authors=before.authors.map(a=>live.has(a.id)?ordered[next++]:a);
  assert.deepEqual(owner(after),owner(expected));
  const backupKey='xivary:local-migration:5:8';const backup=await chrome.evaluate(settings.sessionId,`chrome.storage.local.get(${JSON.stringify(backupKey)}).then(v=>v[${JSON.stringify(backupKey)}])`);assert.deepEqual(owner(backup.source),owner(before));
  library=await page('library/library.html');await chrome.until(library.sessionId,"document.querySelectorAll('.paper-row').length===2");
  assert.deepEqual(await chrome.evaluate(library.sessionId,"[...document.querySelectorAll('.collection-link')].slice(1).map(node=>node.dataset.collectionId)"),before.paperOrdering.collectionIds);
  await chrome.click(library.sessionId,`.collection-link[data-collection-id="${collections.a}"]`);assert.deepEqual(await chrome.evaluate(library.sessionId,"[...document.querySelectorAll('.paper-row h2 a')].map(a=>a.href.split('/abs/')[1])"),['2610.00002','2610.00001']);await shot(library,'schema8-library.png');
  assert.deepEqual(await chrome.evaluate(settings.sessionId,client("repository.getOfflineCopy('2610.00001')")),offlineBefore);assert.equal(await chrome.evaluate(settings.sessionId,client("(await repository.readOfflinePdf('2610.00001')).blob.text()")),pdf);
  const feed=await page('feed/feed.html');await chrome.until(feed.sessionId,"document.querySelectorAll('.paper-row').length===1 && !document.querySelector('#refresh').disabled");assert.equal(await chrome.evaluate(feed.sessionId,"document.querySelector('.paper-row h2').textContent"),paper(3).title);assert.equal(await chrome.evaluate(feed.sessionId,"document.querySelector('#status').classList.contains('error')"),false);
  const following=await page('authors/authors.html');await chrome.until(following.sessionId,"document.querySelectorAll('.author-row').length===2");
  await chrome.send('ServiceWorker.enable',{},settings.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},settings.sessionId);await chrome.evaluate(settings.sessionId,client('repository.initialize()'));assert.deepEqual(owner(await chrome.evaluate(settings.sessionId,state)),owner(expected));
  // Incompatible completed data gets a Retry state, never a fake empty Library.
  const active=await chrome.evaluate(settings.sessionId,state),damaged=structuredClone(active);delete damaged.paperOrdering;
  await chrome.evaluate(settings.sessionId,`chrome.storage.local.set({arxivResearchLibrary:${JSON.stringify(damaged)}})`);await chrome.send('Page.reload',{},library.sessionId);
  await chrome.until(library.sessionId,"!document.querySelector('#retry-storage').hidden && document.querySelector('#status').textContent.includes('Missing Library ordering')");assert.equal(await chrome.evaluate(library.sessionId,"document.querySelector('#empty').hidden"),true);assert.deepEqual(await chrome.evaluate(settings.sessionId,state),damaged);await shot(library,'recoverable-error.png');
  await chrome.evaluate(settings.sessionId,`chrome.storage.local.set({arxivResearchLibrary:${JSON.stringify(active)}})`);await chrome.click(library.sessionId,'#retry-storage');await chrome.until(library.sessionId,"document.querySelectorAll('.paper-row').length===2 && document.querySelector('#retry-storage').hidden");
  // Repeated unchanged-version reload and full profile restart preserve data and backup.
  await reloadExtension();assert.deepEqual(owner(await chrome.evaluate(settings.sessionId,state)),owner(expected));
  await chrome.close();chrome=new ChromiumTestSession(profile);assert.equal((await chrome.send('Extensions.loadUnpacked',{path:extension})).id,id);await enable();await settingsPage();
  assert.deepEqual(owner(await chrome.evaluate(settings.sessionId,state)),owner(expected));assert.deepEqual(await chrome.evaluate(settings.sessionId,`chrome.storage.local.get(${JSON.stringify(backupKey)}).then(v=>v[${JSON.stringify(backupKey)}])`),backup);
  assert.equal(await chrome.evaluate(settings.sessionId,client("(await repository.readOfflinePdf('2610.00001')).blob.text()")),pdf);
  console.log(`MIGRATION PASS: exact real old-worker/new-UI collectionIds crash and validated DTO repair; unchanged-version actual unpacked upgrade, schema 5→8, custom titles/aliases/notes/preferences, explicit collection/paper ordering, memberships, local recovery snapshot, Feed and PDF byte retention, concurrent reads, worker suspension, retry error state, repeated reload and profile restart; screenshots ${screenshots}`);
} finally {await chrome.close();await rm(temporary,{recursive:true,force:true});}
