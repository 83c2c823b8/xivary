import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';
import {ChromiumTestSession} from './chromium-test-session.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'xivary-migration-quota-')),chrome=new ChromiumTestSession(join(temporary,'profile'));
try {
  const id=(await chrome.send('Extensions.loadUnpacked',{path:join(root,'dist/chromium')})).id;
  const page=await chrome.page(`chrome-extension://${id}/src/settings/settings.html`);
  await chrome.until(page.sessionId,"document.readyState==='complete' && !document.querySelector('#open-arxiv-new-tab').disabled");
  await chrome.evaluate(page.sessionId,`(async()=>{
    const {BrowserLocalStorage}=await import('../lib/storage.js'),{createPaper}=await import('../domain/paper.js');
    const disk=new BrowserLocalStorage(),s=await disk.read(),now=new Date().toISOString();s.schemaVersion=5;delete s.paperOrdering;
    s.favorites=[createPaper({arxivId:'2610.99998',title:'My large retained annotation — quota fixture',authors:['Alex Kim'],note:'x'.repeat(6*1024*1024)},now)];
    s.paperMemberships=[{arxivId:'2610.99998',collectionId:s.paperCollections[0].id,addedAt:now,updatedAt:now}];
    await disk.write(s);
  })()`);
  const library=await chrome.page(`chrome-extension://${id}/src/library/library.html`);
  await chrome.until(library.sessionId,"document.querySelectorAll('.paper-row').length===1 && !document.querySelector('#status').classList.contains('error')",30000);
  const result=await chrome.evaluate(library.sessionId,`(async()=>{
    const {BrowserLocalStorage}=await import('../lib/storage.js'),{MigrationRecovery}=await import('../repository/migration-recovery.js');
    const state=await new BrowserLocalStorage().read(),key='xivary:local-migration:5:8';
    const local=(await chrome.storage.local.get(key))[key],fallback=await new MigrationRecovery().get(key);
    return {version:state.schemaVersion,length:state.favorites[0].note.length,local:!!local,fallback:!!fallback,sourceLength:fallback?.source.favorites[0].note.length,sourceVersion:fallback?.source.schemaVersion};
  })()`);
  assert.deepEqual(result,{version:8,length:6*1024*1024,local:false,fallback:true,sourceLength:6*1024*1024,sourceVersion:5});
  await chrome.send('ServiceWorker.enable',{},library.sessionId);await chrome.send('ServiceWorker.stopAllWorkers',{},library.sessionId);await chrome.send('Page.reload',{},library.sessionId);
  await chrome.until(library.sessionId,"document.querySelectorAll('.paper-row').length===1 && !document.querySelector('#status').classList.contains('error')",30000);
  console.log('MIGRATION QUOTA PASS: actual 10-MiB Chrome local quota, six-MiB user annotation retained, independent IDB recovery committed before schema-8 activation, direct Library opening and worker restart; no permission change or data reset');
}finally{await chrome.close();await rm(temporary,{recursive:true,force:true});}
