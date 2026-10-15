import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalRepository } from '../extension/src/repository/local-repository.js';
import { RepositoryClient } from '../extension/src/repository/repository-client.js';
import { createRepositoryHandler } from '../extension/src/background/repository-handler.js';
import { readBackupZip, writeBackupZip, decodeBase64, encodeBase64, crc32 } from '../extension/src/repository/backup-zip.js';
const now='2026-10-15T00:00:00Z';
const paper=i=>({arxivId:i===3?'math/0601001':`2610.${String(i).padStart(5,'0')}`,title:`Custom title ${i} — 猫 & <research>`,authors:['Alex Kim'],tags:['自分'],note:'Existing metadata',read:true});
function fixture(prefix='local') {
  let state,serial=0,writes=0,fail=false;
  const storage={read:async()=>structuredClone(state),write:async next=>{if(fail)throw Error('disk full');state=structuredClone(next);writes++;}};
  const repo=new LocalRepository(storage,()=>now,()=>`${prefix}-${++serial}`),handler=createRepositoryHandler(repo,'test');
  const client=new RepositoryClient({sendMessage:message=>new Promise(resolve=>handler(message,{id:'test'},resolve))});
  return {repo,client,storage,state:()=>structuredClone(state),writes:()=>writes,fail:()=>{fail=true;}};
}
const input=backup=>({kind:backup.base64?'zip':'json',data:backup.base64??backup.text});
async function source() {
  const f=fixture('source');for(const i of [3,1,2])await f.client.savePaper(paper(i));
  const a=await f.client.createPaperCollection('名前 / "Geometry"',paper(1)),b=await f.client.createPaperCollection('Second',paper(1));
  for(const i of [2,3])await f.client.addPaperToCollection(paper(i),a.id);
  await f.client.movePaperCollection(b.id,a.id);await f.client.movePaperInCollection(a.id,paper(2).arxivId,paper(3).arxivId);
  await f.client.followAuthor({displayName:'Renée Smith'});await f.client.followAuthor({displayName:'Alex Kim'});
  const state=f.state();state.favorites[1].originalTitle='Original arXiv title';state.favorites[1].customTitle=state.favorites[1].title;
  state.favorites[1].userMetadata={label:'手書き',nested:{value:42}};
  state.authors[0].alias='Renée / My advisor';state.authors[0].searchIdentifiers={query:'au:"Renée Smith"'};
  state.authors[0].aliases=['R. Smith','先生'];
  state.followingFeedCache={secret:'not portable'};state.followingFeedEvidence={secret:'not portable'};state._arxivApi={until:1000};
  await f.storage.write(state);return {...f,a,b};
}
function owned(state) {
  const ordered=['favorites','authors','paperOrdering'];
  return Object.fromEntries(['favorites','authors','paperCollections','collections','paperMemberships','memberships','paperOrdering'].map(field=>[field,ordered.includes(field)?state[field]:[...state[field]].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}
test('complete multi-file ZIP restores custom fields, Unicode, memberships and exact local/manual order with one write',async()=>{
  const s=await source(),d=fixture('destination');await d.client.initialize();const initialWrites=d.writes();const backup=await s.client.exportBackup('all');
  assert.match(backup.filename,/\.zip$/);const files=await readBackupZip(decodeBase64(backup.base64));
  assert.equal(files.filter(f=>f.path.includes('/bookmarks/')).length,3);assert.equal(files.filter(f=>f.path.includes('/following/')).length,2);
  for(const file of files)assert.ok(!/secret|followingFeed|chromeSync|lastUsed|pdfUrl|absUrl/.test(file.text));
  const result=await d.client.importBackup([input(backup)]);assert.equal(result.invalid,0);assert.equal(d.writes()-initialWrites,1);
  assert.deepEqual(owned(d.state()),owned(s.state()));assert.equal(d.state().settings.openArxivLinksInNewTab,false);
  const before=owned(d.state());await d.client.importBackup([input(backup)]);assert.deepEqual(owned(d.state()),before);
});
test('individual bookmark/Following/collection JSON and multiple individual imports include complete dependencies',async()=>{
  const s=await source();
  for(const [category,selection] of [['bookmarks',{kind:'record',id:paper(1).arxivId}],['following',{kind:'record',id:s.state().authors[0].id}],['bookmarks',{kind:'collection',collectionId:s.a.id}]]){
    const backup=await s.client.exportBackup(category,selection),d=fixture();assert.match(backup.filename,/\.json$/);
    await d.client.importBackup([input(backup)]);const state=d.state();
    if(category==='following')assert.equal(state.authors[0].alias,'Renée / My advisor');
    else {assert.ok(state.favorites.some(p=>p.arxivId===paper(1).arxivId));assert.ok(state.paperMemberships.length);}
  }
  const one=await s.client.exportBackup('bookmarks',{kind:'record',id:paper(1).arxivId}),two=await s.client.exportBackup('bookmarks',{kind:'record',id:paper(2).arxivId}),d=fixture();
  const result=await d.client.importBackup([input(one),input(two)]);assert.ok(result.skipped>0);assert.equal(d.state().favorites.length,2);
  assert.equal(d.state().paperMemberships.filter(m=>m.collectionId===s.a.id).length,2);
});
test('section ZIP and category-selected full ZIP leave other category, preferences, caches and Offline metadata untouched',async()=>{
  const s=await source(),d=fixture();await d.client.followAuthor({displayName:'Local Researcher'});
  const state=d.state();state.offlineSentinel={pdf:'keep'};state.authorPaperCaches=[];await d.storage.write(state);
  const before=d.state();await d.client.importBackup([input(await s.client.exportBackup('all'))],'bookmarks');
  for(const field of ['authors','memberships','collections','authorPaperCaches','offlineSentinel'])assert.deepEqual(d.state()[field],before[field]);
  const book=d.state();await d.client.importBackup([input(await s.client.exportBackup('following'))],'following');
  for(const field of ['favorites','paperCollections','paperMemberships','paperOrdering'])assert.deepEqual(d.state()[field],book[field]);
});
test('section and collection exports preserve custom fields/order, empty collections and colliding collection display names',async()=>{
  const s=await source();
  for(const [category,create,get,fields] of [
    ['bookmarks','createPaperCollection','getPaperLibrary',['favorites','paperCollections','paperMemberships','paperOrdering']],
    ['following','createAuthorCollection','getAuthorLibrary',['authors','collections','memberships']],
  ]) {
    const empty=await s.client[create]('Empty — shared name');
    const section=await s.client.exportBackup(category),d=fixture('destination');
    await d.client.importBackup([input(section)],category);
    for(const field of fields)assert.deepEqual(owned(d.state())[field],owned(s.state())[field]);
    const library=await s.client[get](),collection=category==='bookmarks'?s.a:library.collections[0];
    const selected=await s.client.exportBackup(category,{kind:'collection',collectionId:collection.id}),one=fixture('selected');
    await one.client.importBackup([input(selected)],category);
    const restored=await one.client[get](),doc=JSON.parse(selected.text);
    assert.equal(restored.collections.find(c=>c.id===collection.id).name,collection.name);
    assert.equal(restored.memberships.length,library.memberships.filter(m=>m.collectionId===collection.id).length);
    if(category==='bookmarks') {
      assert.deepEqual(restored.ordering.paperOrders.find(o=>o.collectionId===collection.id).paperIds,doc.ordering.papersByCollection.find(o=>o.collectionId===collection.id).paperIds);
      assert.equal(restored.papers.find(p=>p.arxivId===paper(1).arxivId).customTitle,paper(1).title);
    } else assert.equal(restored.authors.find(a=>a.displayName==='Renée Smith').alias,'Renée / My advisor');
    const emptyFile=await s.client.exportBackup(category,{kind:'collection',collectionId:empty.id}),fresh=fixture('empty');
    await fresh.client.importBackup([input(emptyFile)],category);
    const emptyLibrary=await fresh.client[get]();
    assert.ok(emptyLibrary.collections.some(c=>c.id===empty.id&&c.name===empty.name));assert.equal(emptyLibrary.memberships.length,0);
    const populated=fixture('collision'),existing=await populated.client[create](empty.name);
    const result=await populated.client.importBackup([input(emptyFile)],category),after=await populated.client[get]();
    assert.ok(result.conflicts>0);assert.equal(after.collections.find(c=>c.id===existing.id).name,empty.name);
    assert.equal(after.collections.find(c=>c.id===empty.id).name,`${empty.name} (2)`);
    await populated.client.importBackup([input(emptyFile)],category);assert.deepEqual(await populated.client[get](),after);
  }
});
test('existing customized names and metadata win, imported aliases fill absent fields; unrelated order is stable',async()=>{
  const s=await source(),d=fixture();await d.client.savePaper({...paper(1),title:'My destination name',note:'My own note'});await d.client.savePaper(paper(4));
  await d.client.followAuthor({displayName:'Renée Smith'});
  const state=d.state();state.authors[0].alias='Local alias';await d.storage.write(state);
  const result=await d.client.importBackup([input(await s.client.exportBackup('all'))]);assert.ok(result.conflicts>0);
  assert.equal(d.state().favorites[0].title,'My destination name');assert.equal(d.state().favorites[0].note,'My own note');
  assert.equal(d.state().authors[0].alias,'Local alias');assert.deepEqual(d.state().favorites.slice(0,2).map(p=>p.arxivId),[paper(1).arxivId,paper(4).arxivId]);
  assert.ok(d.state().favorites[0].customTitle);assert.equal(d.state().favorites.filter(p=>p.arxivId===paper(1).arxivId).length,1);
});
test('all files validate before one write; bad JSON/version/reference, conflicting records and failed commits preserve state',async()=>{
  const s=await source(),d=fixture();await d.client.savePaper(paper(4));
  const good=await s.client.exportBackup('bookmarks',{kind:'collection',collectionId:s.a.id}),base=JSON.parse(good.text),before=d.state(),writes=d.writes();
  for(const mutate of [doc=>doc.version=999,doc=>doc.records.pop(),doc=>doc.records[0].record.authors[0].id='bad',doc=>doc.ordering.bookmarks.reverse().push('missing')]){
    const broken=structuredClone(base);mutate(broken);await assert.rejects(d.client.importBackup([input(good),{kind:'json',data:JSON.stringify(broken)}]));assert.deepEqual(d.state(),before);assert.equal(d.writes(),writes);
  }
  await assert.rejects(d.client.importBackup([{kind:'json',data:'{ invalid'}]),/not valid JSON/);
  const conflict=structuredClone(base);conflict.records[0].record.title='Another title';await assert.rejects(d.client.importBackup([input(good),{kind:'json',data:JSON.stringify(conflict)}]),/conflicting duplicate/);
  const missing=structuredClone(base);missing.records=missing.records.filter(r=>r.type!=='bookmark');await assert.rejects(d.client.importBackup([{kind:'json',data:JSON.stringify(missing)}]),/missing referenced/);
  d.fail();await assert.rejects(d.client.importBackup([input(good)]),/disk full/);assert.deepEqual(d.state(),before);
});
test('ZIP transport rejects traversal, duplicates, truncated/CRC data, oversized JSON and mismatched manifests',async()=>{
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  assert.throws(()=>writeBackupZip([{path:'../escape.json',text:'{}'}]),/unsafe/);
  assert.throws(()=>writeBackupZip(Array(2).fill({path:'xivary-backup/manifest.json',text:'{}'})),/duplicate/);
  assert.throws(()=>writeBackupZip([{path:'xivary-backup/manifest.json',text:'x'.repeat(1024*1024+1)}]),/1 MiB/);
  const s=await source(),backup=await s.client.exportBackup('all'),bytes=decodeBase64(backup.base64);
  await assert.rejects(readBackupZip(bytes.slice(0,-1)));
  const damaged=bytes.slice();damaged[100]^=1;await assert.rejects(readBackupZip(damaged));
  const files=await readBackupZip(bytes),manifest=JSON.parse(files[0].text);manifest.counts.bookmarks=99;files[0].text=JSON.stringify(manifest);
  await assert.rejects(fixture().client.importBackup([{kind:'zip',data:encodeBase64(writeBackupZip(files))}]),/count mismatch/);
});
test('canonical modern/legacy/version identifiers deduplicate without dropping user metadata',async()=>{
  const s=await source(),doc=JSON.parse((await s.client.exportBackup('bookmarks',{kind:'record',id:paper(3).arxivId})).text);
  doc.records.find(r=>r.type==='bookmark').record.arxivId='https://arxiv.org/abs/math/0601001v2';
  const d=fixture();await d.client.importBackup([{kind:'json',data:JSON.stringify(doc)}]);assert.equal(d.state().favorites[0].arxivId,'math/0601001');
});

test('standard Deflate backups are accepted; encryption, traversal, duplicate paths and bombs are rejected',async()=>{
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFileSync}=await import('node:child_process');
  const directory=await mkdtemp(join(tmpdir(),'xivary-backup-zip-'));
  try {
    const s=await source(),bytes=decodeBase64((await s.client.exportBackup('all')).base64);
    await writeFile(join(directory,'stored.zip'),bytes);
    execFileSync('python3',['-c',`import zipfile\nwith zipfile.ZipFile('stored.zip') as src, zipfile.ZipFile('deflated.zip','w',compression=zipfile.ZIP_DEFLATED) as dst:\n for item in src.infolist(): dst.writestr(item.filename,src.read(item))`,],{cwd:directory});
    const compressed=new Uint8Array(await readFile(join(directory,'deflated.zip'))),d=fixture();
    await d.client.importBackup([{kind:'zip',data:encodeBase64(compressed)}]);assert.equal(d.state().favorites.length,3);
    execFileSync('unzip',['-t','stored.zip'],{cwd:directory});
    for(const kind of ['traversal','duplicate','encrypted','bomb']){
      execFileSync('python3',['-c',`import zipfile,struct\nwith zipfile.ZipFile('stored.zip') as src, zipfile.ZipFile('bad.zip','w') as dst:\n for i,item in enumerate(src.infolist()):\n  name=item.filename\n  if '${kind}'=='traversal' and i==0: name='../manifest.json'\n  if '${kind}'=='duplicate' and i==1: name='xivary-backup/manifest.json'\n  dst.writestr(name,src.read(item))\nif '${kind}' in ('encrypted','bomb'):\n data=bytearray(open('bad.zip','rb').read()); local=data.index(b'PK\\x03\\x04'); central=data.index(b'PK\\x01\\x02')\n if '${kind}'=='encrypted': struct.pack_into('<H',data,local+6,1);struct.pack_into('<H',data,central+8,1)\n else: struct.pack_into('<I',data,local+22,30*1024*1024);struct.pack_into('<I',data,central+24,30*1024*1024)\n open('bad.zip','wb').write(data)`,],{cwd:directory,stdio:'pipe'});
      await assert.rejects(readBackupZip(new Uint8Array(await readFile(join(directory,'bad.zip')))),/Invalid backup ZIP/);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('explicit original/custom titles restore into an uncustomized destination; customized empty collections remain intact',async()=>{
  const s=await source(),d=fixture();await d.client.savePaper({...paper(1),title:'Original arXiv title'});
  await d.client.importBackup([input(await s.client.exportBackup('all'))]);assert.equal(d.state().favorites.find(p=>p.arxivId===paper(1).arxivId).title,paper(1).title);
  const empty=fixture();await empty.client.getPaperLibrary();
  // Initialize through the repository, then seed a supported customization as a fixture.
  await empty.client.createPaperCollection('Temporary');await empty.client.deletePaperCollection('paper-collection:local-1');
  const decorated=empty.state();decorated.paperCollections[0].customName='My empty collection customization';await empty.storage.write(decorated);
  await empty.client.importBackup([input(await s.client.exportBackup('all'))]);assert.equal(empty.state().paperCollections[0].customName,'My empty collection customization');
});

test('membership additions to existing unchanged collections are reported as merges',async()=>{
  const s=await source(),d=fixture();
  const one=await s.client.exportBackup('bookmarks',{kind:'record',id:paper(1).arxivId});await d.client.importBackup([input(one)]);
  const result=await d.client.importBackup([input(await s.client.exportBackup('bookmarks',{kind:'record',id:paper(2).arxivId}))]);
  assert.equal(result.imported,1);assert.ok(result.merged>=2);assert.ok(d.state().paperMemberships.some(m=>m.arxivId===paper(2).arxivId&&m.collectionId===s.a.id));
});
